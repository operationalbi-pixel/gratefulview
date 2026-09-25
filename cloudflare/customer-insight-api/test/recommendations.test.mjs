import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWaiterScript,
  fallbackRecommendations,
  menuFamily,
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

test('AI output can only select alternative menus, never the habitual order', () => {
  const habitual = [
    { menu: 'Nasi Goreng', category: 'Main Course', count: 5 },
    { menu: 'Iced Tea', category: 'Beverage', count: 3 }
  ];
  const alternatives = [
    { menu: 'Chicken Fried Rice', category: 'Main Course', family: 'rice', anchorMenu: 'Nasi Goreng' },
    { menu: 'Peach Tea', category: 'Beverage', family: 'tea', anchorMenu: 'Iced Tea' }
  ];
  const result = sanitizeAiRecommendations({
    smartRecommendation: [
      { menu: 'Nasi Goreng', reason: 'Tidak boleh mengulang favorit' },
      { menu: 'Peach Tea', reason: 'Alternatif teh' }
    ],
    serviceApproach: 'Mulai dari favorit.'
  }, habitual, alternatives, { groupVisitor: false, weekdayVisits: 3, weekendVisits: 1 });

  assert.deepEqual(result.smartRecommendation.map(row => row.menu), ['Peach Tea']);
  assert.match(result.aiScript, /Nasi Goreng/);
  assert.match(result.aiScript, /Iced Tea/);
  assert.equal(result.aiGenerated, true);
});

test('fallback remains useful when Workers AI is unavailable', () => {
  const result = fallbackRecommendations(
    [{ menu: 'Chicken Pasta', category: 'Main Course', count: 2 }],
    [{ menu: 'Truffle Chicken Pasta', category: 'Main Course', family: 'pasta', anchorMenu: 'Chicken Pasta', matchType: 'same_family' }],
    { groupVisitor: true, weekdayVisits: 0, weekendVisits: 2 }
  );

  assert.equal(result.smartRecommendation[0].menu, 'Truffle Chicken Pasta');
  assert.match(result.smartRecommendation[0].reason, /pasta/i);
  assert.equal(result.aiGenerated, false);
});

test('waiter script contains food and drink the customer usually orders', () => {
  const script = buildWaiterScript([
    { menu: 'Chicken Pasta', category: 'Main Course' },
    { menu: 'Iced Lemon Tea', category: 'Beverage' }
  ]);
  assert.match(script, /Chicken Pasta/);
  assert.match(script, /Iced Lemon Tea/);
});

test('menu family keeps chicken and pasta alternatives semantically aligned', () => {
  assert.equal(menuFamily({ menu: 'Roasted Chicken' }), 'chicken');
  assert.equal(menuFamily({ menu: 'Truffle Fettuccine' }), 'pasta');
});
