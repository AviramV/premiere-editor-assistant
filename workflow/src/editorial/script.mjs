import { digest } from '../premiere/state.mjs';

const contractions = { "i'm": 'i am', "it's": 'it is', "that's": 'that is', "there's": 'there is',
  "you're": 'you are', "you've": 'you have', "we're": 'we are', "don't": 'do not', "doesn't": 'does not',
  "can't": 'cannot', "isn't": 'is not', "everything's": 'everything is', "product's": 'product is' };

export function tokens(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'");
  return (normalized.match(/[a-z0-9]+(?:'[a-z]+)?/g) || []).flatMap(word => (contractions[word] || word).split(' '));
}

export function validateScript(input) {
  if (input.language !== 'en' || !Array.isArray(input.passages) || !input.passages.length) throw new Error('English passages required');
  const ids = new Set();
  for (const passage of input.passages) {
    if (!/^[A-Za-z0-9_-]+$/.test(passage.id) || ids.has(passage.id) || !tokens(passage.text).length) throw new Error('Unique passage IDs and nonempty text required');
    ids.add(passage.id);
    if (passage.protectedTerms !== undefined && (!Array.isArray(passage.protectedTerms) || passage.protectedTerms.some(term => !tokens(term).length))) throw new Error('Invalid protected wording');
    if (passage.variants !== undefined && (!Array.isArray(passage.variants) || passage.variants.some(text => !tokens(text).length))) throw new Error('Invalid passage variants');
  }
  for (const version of input.versions || []) {
    if (!version.id || !version.passageIds?.length || version.passageIds.some(id => !ids.has(id))) throw new Error('Version references missing passages');
  }
  return { ...input, revision: digest({ language: input.language, passages: input.passages, versions: input.versions }) };
}

export function protectedIssues(passage, spoken) {
  const heard = ` ${tokens(spoken).join(' ')} `;
  const required = [...(passage.protectedTerms || []), ...(passage.text.match(/\b\d+(?:[.,]\d+)?\b/g) || [])];
  return required.filter(term => !heard.includes(` ${tokens(term).join(' ')} `)).map(term => ({ code: 'protected_wording_missing_or_changed', term }));
}
