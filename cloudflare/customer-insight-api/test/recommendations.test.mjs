import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackRecommendations,
  recommendationCandidates,
  sanitizeAiRecommendations
} from '../src/index.js';

test('recommendation candidates are unique and limited to actual order history', () => {
  const rows = recommendationCandidates({
    favorite_menu_json: JSON.stringify([
      { menu: 'Nasi Goreng', category: 'Main Course', count: 5 },
      { menu: 'Iced Tea', category: 'Beverage', count: 3 }
    ]),
    last_order_json: JSON.stringify(['Nasi Goreng', 'Croissant'])
  });

  assert.deepEqual(rows.map(row => row.menu), ['Nasi Goreng', 'Iced Tea', 'Croissant']);
});

test('AI output cannot introduce a menu outside the supplied candidates', () => {
  const candidates = [
    { menu: 'Nasi Goreng', category: 'Main Course', count: 5 },
    { menu: 'Iced Tea', category: 'Beverage', count: 3 }
  ];
  const result = sanitizeAiRecommendations({
    smartRecommendation: [
      { menu: 'Steak Mahal', reason: 'Halusinasi' },
      { menu: 'Iced Tea', reason: 'Sesuai pesanan sebelumnya' }
    ],
    aiScript: 'Tawarkan Iced Tea.',
    serviceApproach: 'Mulai dari favorit.'
  }, candidates, { groupVisitor: false, weekdayVisits: 3, weekendVisits: 1 });

  assert.deepEqual(result.smartRecommendation.map(row => row.menu), ['Iced Tea']);
  assert.equal(result.aiGenerated, true);
});

test('fallback remains useful when Workers AI is unavailable', () => {
  const result = fallbackRecommendations(
    [{ menu: 'Croissant', category: 'Bakery', count: 2 }],
    { groupVisitor: true, weekdayVisits: 0, weekendVisits: 2 }
  );

  assert.equal(result.smartRecommendation[0].menu, 'Croissant');
  assert.match(result.smartRecommendation[0].reason, /grup/i);
  assert.equal(result.aiGenerated, false);
});
