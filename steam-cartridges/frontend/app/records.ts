// app/records: the one place a GameRecord is created (migration plan M4c).
import type { ShortcutId } from "../kernel/appid";
import { toGameId } from "../kernel/appid";
import type { EventBus } from "../kernel/events";
import { createRecordStore, type RecordStore } from "../kernel/record";

export function createRecords(bus: EventBus): { store: RecordStore; ensureBase(appid: ShortcutId, title: string): void } {
    const store = createRecordStore(bus);
    return {
        store,
        ensureBase(appid, title) {
            store.upsert({ appid, gameid: toGameId(appid), title, exe: "" });
        },
    };
}
