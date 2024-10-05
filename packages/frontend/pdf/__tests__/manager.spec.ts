import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { nanoid } from '@blocksuite/affine/store';
import { assert, expect, test } from 'vitest';

import { PdfManager } from '../index';

test('pdf manager', async () => {
  const path = fileURLToPath(new URL('..', import.meta.url));
  const manager = PdfManager.bindToLibrary(path);

  const filepath = fileURLToPath(
    new URL('./fixtures/minimal.pdf', import.meta.url)
  );
  const bytes = readFileSync(filepath);

  const id = nanoid();

  const doc = manager.open(id, bytes);
  assert(doc);

  const pages = doc.pages();
  expect(pages.len()).toBe(1);

  const page = pages.get(0);
  assert(page);
  expect(page.text().length).gt(0);

  const doc2 = manager.openWithId(id);
  assert(doc2);

  const pages2 = doc2.pages();
  expect(pages2.len()).toBe(1);

  const page2 = pages2.get(0);
  assert(page2);
  console.log(page2.text());
});
