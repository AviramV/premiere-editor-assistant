"""Local semantic retrieval plus claim entailment. No project text is uploaded."""
import argparse
import json
import pathlib
import os
import re

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--cache', required=True)
parser.add_argument('--embedding-model', default='BAAI/bge-small-en-v1.5')
parser.add_argument('--nli-model', default='cross-encoder/nli-deberta-v3-small')
parser.add_argument('--embedding-revision')
parser.add_argument('--nli-revision')
args = parser.parse_args()
pins = {'BAAI/bge-small-en-v1.5': '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a',
    'cross-encoder/nli-deberta-v3-small': 'fa2804872c3b4bd748f38c0185cc85775361e735'}
args.embedding_revision = args.embedding_revision or pins.get(args.embedding_model)
args.nli_revision = args.nli_revision or pins.get(args.nli_model)
if not all(re.fullmatch(r'[0-9a-f]{40}', value or '') for value in [args.embedding_revision, args.nli_revision]):
    parser.error('Both models require an immutable 40-character commit revision')
os.environ['HF_HOME'] = args.cache
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
import torch
from transformers import AutoTokenizer, AutoModel, AutoModelForSequenceClassification

torch.set_num_threads(4)
job = json.loads(pathlib.Path(args.input).read_text())
tokenizer = AutoTokenizer.from_pretrained(args.embedding_model, revision=args.embedding_revision, trust_remote_code=False)
model = AutoModel.from_pretrained(args.embedding_model, revision=args.embedding_revision, trust_remote_code=False, use_safetensors=True).eval()
embedding_revision = model.config._commit_hash
if embedding_revision != args.embedding_revision:
    raise SystemExit('Embedding model revision does not match the pinned input')

def encode(texts):
    parts = []
    with torch.no_grad():
        for offset in range(0, len(texts), 32):
            batch = tokenizer(texts[offset:offset+32], padding=True, truncation=True,
                max_length=256, return_tensors='pt')
            embeddings = model(**batch).last_hidden_state[:, 0]
            parts.append(torch.nn.functional.normalize(embeddings, p=2, dim=1))
    return torch.cat(parts) if parts else torch.empty((0, model.config.hidden_size))

passages = job['passages']
windows = job.get('windows', [])
queries = encode([p['text'] for p in passages])
window_vectors = encode([w['text'] for w in windows])
candidates = list(job.get('candidates', []))
if windows:
    for index, passage in enumerate(passages):
        similarities = (window_vectors @ queries[index]).tolist()
        best = sorted(range(len(windows)), key=lambda i: similarities[i], reverse=True)[:40]
        for position in best:
            if similarities[position] >= 0.7:
                candidate = dict(windows[position])
                candidate['passageId'] = passage['id']
                candidates.append(candidate)
unique = {(c['passageId'], c['firstWord'], c['lastWord']): c for c in candidates}
candidates = list(unique.values())
texts = encode([c['text'] for c in candidates])
query_index = {p['id']: i for i, p in enumerate(passages)}
del model
nli_tokenizer = AutoTokenizer.from_pretrained(args.nli_model, revision=args.nli_revision, trust_remote_code=False)
nli = AutoModelForSequenceClassification.from_pretrained(args.nli_model, revision=args.nli_revision, trust_remote_code=False, use_safetensors=True).eval()
if nli.config._commit_hash != args.nli_revision:
    raise SystemExit('NLI model revision does not match the pinned input')
# The publisher documents label order: contradiction, entailment, neutral.
if nli.config.num_labels != 3:
    raise SystemExit('Unexpected NLI label schema')
results = []
with torch.no_grad():
    for offset in range(0, len(candidates), 16):
        batch = candidates[offset:offset+16]
        encoded = nli_tokenizer([c['text'] for c in batch],
            [passages[query_index[c['passageId']]]['text'] for c in batch],
            padding=True, truncation=True, max_length=256, return_tensors='pt')
        probabilities = torch.softmax(nli(**encoded).logits, dim=1).tolist()
        for j, candidate in enumerate(batch):
            candidate['semantic'] = {'similarity': float(texts[offset+j] @ queries[query_index[candidate['passageId']]]),
                'contradiction': probabilities[j][0], 'entailment': probabilities[j][1], 'neutral': probabilities[j][2]}
            results.append(candidate)
output = {'candidates': results, 'models': {'embedding': args.embedding_model,
    'embedding_revision': embedding_revision, 'nli': args.nli_model,
    'nli_revision': nli.config._commit_hash}, 'text_upload': False}
target = pathlib.Path(args.output)
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(output, ensure_ascii=False, indent=2))
print(json.dumps({'candidates': len(results), 'output': str(target), 'text_upload': False}))
