"""Local-only MLX transcription; preserve original segments and word timestamps."""
import argparse
import json
import pathlib
import time
import mlx_whisper

parser = argparse.ArgumentParser()
parser.add_argument('--audio', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--model', default='mlx-community/whisper-small.en-mlx')
parser.add_argument('--prompt', default='')
args = parser.parse_args()
audio = pathlib.Path(args.audio)
if not audio.is_file():
    raise SystemExit('Local audio input is missing')
started = time.monotonic()
result = mlx_whisper.transcribe(str(audio), path_or_hf_repo=args.model,
    language='en', word_timestamps=True, temperature=0.0,
    initial_prompt=args.prompt or None, condition_on_previous_text=False,
    hallucination_silence_threshold=2.0, verbose=False)
result['provider_metadata'] = {'provider': 'mlx-whisper', 'model': args.model,
    'audio_upload': False, 'elapsed_seconds': time.monotonic() - started}
output = pathlib.Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
temporary = output.with_suffix(output.suffix + '.tmp')
temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2))
temporary.replace(output)
print(json.dumps({'provider': 'mlx-whisper', 'rawOutput': str(output),
    'words': sum(len(s.get('words', [])) for s in result.get('segments', [])),
    'elapsed_seconds': result['provider_metadata']['elapsed_seconds']}))
