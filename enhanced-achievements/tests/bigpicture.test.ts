// Forced Big Picture position (ADR-0049): the placeholder CSS from this theme's corner and margin
// (frontend/banner/bigpicture.ts), and that it outranks enhanced-notifications' rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bigPicturePlaceholderCss, PLACEHOLDER_SELECTOR } from '../frontend/banner/bigpicture.ts';

const M = { top: 20, right: 30, bottom: 40, left: 50 };

test('Big Picture placeholder: each corner uses its own two margins', () => {
    assert.equal(
        bigPicturePlaceholderCss('top_right', M),
        `${PLACEHOLDER_SELECTOR} { top: 20px !important; bottom: auto !important; right: 30px !important; left: auto !important; }\n`,
    );
    assert.equal(
        bigPicturePlaceholderCss('bottom_left', M),
        `${PLACEHOLDER_SELECTOR} { bottom: 40px !important; top: auto !important; left: 50px !important; right: auto !important; }\n`,
    );
});

test('Big Picture placeholder: centred positions centre horizontally', () => {
    const css = bigPicturePlaceholderCss('top_center', M);
    assert.match(css, /top: 20px !important/);
    assert.match(css, /left: 0 !important; right: 0 !important; margin-left: auto !important; margin-right: auto !important;/);
});

test("Big Picture placeholder: outranks enhanced-notifications' :is(.hash) and Steam's two-class position rules", () => {
    // Specificity counts classes: ours has three, theirs at most two, and every declaration is !important on both sides.
    assert.equal(PLACEHOLDER_SELECTOR.split('.').filter(Boolean).length, 3);
    assert.ok(PLACEHOLDER_SELECTOR.split('.').filter(Boolean).every((c) => c === 'GamepadToastPlaceholder'));
});
