// Which signal sets the type of the toast on screen (surfaces/style/type-source.ts) and the
// PopNextToastNotification wrapper that provides the `pop` signal (steam/toast-pop.ts).
// Regression guard for the Big Picture flicker: a toast that ARRIVES while another is on screen
// must never restyle it (git show 9a7df2b:docs/plans/enhanced-notifications-bigpicture-toast-fix-plan.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { takesSignal, TYPE_SOURCES, viewTakesType } from '../frontend/surfaces/style/type-source.ts';
import { installToastPop } from '../frontend/steam/toast-pop.ts';

test('type source: by default an arriving toast never sets the type, the pop does', () => {
    assert.equal(takesSignal('pop', 'arrival', true), false);
    assert.equal(takesSignal('pop', 'pop', true), true);
    assert.equal(takesSignal('pop', 'shown', true), false, 'the pop already set it, before the toast rendered');
    assert.equal(takesSignal('pop', 'manual', true), false);
});

test('type source: without PopNextToastNotification, pop falls back to shown, still never arrival', () => {
    assert.equal(takesSignal('pop', 'shown', false), true);
    assert.equal(takesSignal('pop', 'arrival', false), false);
    assert.equal(takesSignal('pop', 'pop', false), false);
});

test('type source: the debug sources', () => {
    assert.equal(takesSignal('shown', 'shown', true), true);
    assert.equal(takesSignal('shown', 'pop', true), false);
    assert.equal(takesSignal('arrival', 'arrival', true), true, 'reproduces the old behaviour');
    assert.equal(takesSignal('arrival', 'shown', true), true, 'the old code also took onShown');
    assert.equal(takesSignal('manual', 'manual', true), true);
    assert.equal(takesSignal('manual', 'pop', true), false);
    for (const source of TYPE_SOURCES) assert.equal(takesSignal(source, 'refresh', true), true, `refresh under ${source}`);
});

/** A fake NotificationStore: the method on the prototype, a queue of toasts. */
function fakeStore(queue: ({ eType: number } | undefined)[]) {
    const proto = {
        PopNextToastNotification(this: unknown, _context: number) {
            return queue.shift();
        },
    };
    return { proto, store: Object.create(proto) as Record<string, unknown> & { PopNextToastNotification(ctx: number): unknown } };
}

test('toast pop: returns what Steam returns and reports each real toast once', () => {
    const { store } = fakeStore([{ eType: 1 }, undefined, { eType: 5 }]);
    const seen: number[] = [];
    const off = installToastPop(store, (n) => seen.push(n.eType!), () => assert.fail('no error expected'));
    assert.ok(off);
    assert.deepEqual(store.PopNextToastNotification(0), { eType: 1 });
    assert.equal(store.PopNextToastNotification(0), undefined, 'an empty pop is passed through');
    assert.deepEqual(store.PopNextToastNotification(0), { eType: 5 });
    assert.deepEqual(seen, [1, 5]);
});

test('toast pop: a listener error never breaks Steam', () => {
    const { store } = fakeStore([{ eType: 1 }]);
    const errors: unknown[] = [];
    installToastPop(store, () => { throw new Error('boom'); }, (e) => errors.push(e));
    assert.deepEqual(store.PopNextToastNotification(0), { eType: 1 });
    assert.equal(errors.length, 1);
});

test('toast pop: own property on the instance only; uninstall restores Steam', () => {
    const { proto, store } = fakeStore([{ eType: 1 }]);
    const original = proto.PopNextToastNotification;
    const off = installToastPop(store, () => {}, () => {})!;
    assert.ok(Object.prototype.hasOwnProperty.call(store, 'PopNextToastNotification'));
    assert.equal(proto.PopNextToastNotification, original, 'the prototype is never written');
    off();
    assert.equal(Object.prototype.hasOwnProperty.call(store, 'PopNextToastNotification'), false);
});

test('toast pop: a later prototype wrapper still runs (looked up at call time)', () => {
    const { proto, store } = fakeStore([{ eType: 1 }]);
    const seen: number[] = [];
    installToastPop(store, (n) => seen.push(n.eType!), () => {});
    const original = proto.PopNextToastNotification;
    let wrapped = 0;
    proto.PopNextToastNotification = function (this: unknown, ctx: number) {
        wrapped++;
        return original.call(this, ctx);
    };
    store.PopNextToastNotification(0);
    assert.equal(wrapped, 1);
    assert.deepEqual(seen, [1]);
});

test('toast pop: wrapped on top of us, uninstall leaves the chain and stops reporting', () => {
    const { store } = fakeStore([{ eType: 1 }, { eType: 2 }]);
    const seen: number[] = [];
    const off = installToastPop(store, (n) => seen.push(n.eType!), () => {})!;
    const ours = store.PopNextToastNotification;
    const theirs = function (this: unknown, ctx: number) {
        return ours.call(this, ctx);
    };
    store.PopNextToastNotification = theirs;
    off();
    assert.equal(store.PopNextToastNotification, theirs, 'their wrapper is kept');
    assert.deepEqual(store.PopNextToastNotification(0), { eType: 1 }, 'still passes through');
    assert.deepEqual(seen, [], 'but we no longer report');
});

test('toast pop: no method, no wrapper', () => {
    assert.equal(installToastPop({}, () => {}, () => {}), null);
});

test('toast pop: two installs (another plugin, or the released and the -dev copy), in either order, both hear every pop', () => {
    for (const order of [['en', 'ea'], ['ea', 'en']]) {
        const { proto, store } = fakeStore([{ eType: 1 }, { eType: 5 }]);
        const original = proto.PopNextToastNotification;
        const heard: string[] = [];
        const offs = order.map((who) => installToastPop(store, (n) => heard.push(`${who}:${n.eType}`), () => {})!);
        store.PopNextToastNotification(0);
        store.PopNextToastNotification(0);
        assert.deepEqual(heard.sort(), [`${order[0]}:1`, `${order[0]}:5`, `${order[1]}:1`, `${order[1]}:5`].sort());
        offs.reverse().forEach((off) => off()); // last installed first: everything restored
        assert.equal(Object.prototype.hasOwnProperty.call(store, 'PopNextToastNotification'), false);
        assert.equal(proto.PopNextToastNotification, original);
    }
});

test('a Big Picture view busy with its own toast keeps its type; only a theme or setting change restyles it (consistency plan B2)', () => {
    assert.equal(viewTakesType('pop', false), true, 'an idle view takes the popped toast');
    assert.equal(viewTakesType('pop', true), false, 'the other view, showing its own toast, keeps it');
    assert.equal(viewTakesType('shown', true), false);
    assert.equal(viewTakesType('refresh', true), true, 'a theme change re-applies everywhere');
    assert.equal(viewTakesType('refresh', false), true);
});
