import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toggleFeature } from '../frontend/settings/troubleshooting-core.ts';

const IDS = ['sections', 'captures', 'toasts', 'artwork'];

test('turning off appends the id', () => {
    assert.equal(toggleFeature('', 'toasts', false, IDS), 'toasts');
    assert.equal(toggleFeature('toasts', 'toasts', false, IDS), 'toasts');
});

test('turning on removes the id and keeps the rest in order', () => {
    assert.equal(toggleFeature('sections,toasts,artwork', 'toasts', true, IDS), 'sections,artwork');
    assert.equal(toggleFeature('artwork,sections', 'captures', false, IDS), 'sections,captures,artwork');
});

test('unknown ids are preserved', () => {
    assert.equal(toggleFeature('mystery, sections', 'toasts', false, IDS), 'sections,toasts,mystery');
    assert.equal(toggleFeature('mystery', 'mystery', true, IDS), '');
    assert.equal(toggleFeature('mystery,sections', 'sections', true, IDS), 'mystery');
});
