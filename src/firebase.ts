import { initializeApp } from "firebase/app";
import {
    getDatabase,
    ref,
    set,
    get,
    onValue,
    type Unsubscribe,
} from "firebase/database";
import { firebaseConfig } from "./firebaseConfig";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ROOT = "trapgrid";

export function roomRef(code: string) {
    return ref(db, `${ROOT}/rooms/${code}`);
}

export function stateRef(code: string) {
    return ref(db, `${ROOT}/states/${code}`);
}

export async function writeRoom(code: string, value: unknown) {
    await set(roomRef(code), value);
}

export async function writeState(code: string, value: unknown) {
    await set(stateRef(code), value);
}

export async function readRoom<T>(code: string): Promise<T | null> {
    const snap = await get(roomRef(code));
    return snap.exists() ? (snap.val() as T) : null;
}

export async function readState<T>(code: string): Promise<T | null> {
    const snap = await get(stateRef(code));
    return snap.exists() ? (snap.val() as T) : null;
}

export function watchRoom<T>(code: string, cb: (value: T | null) => void): Unsubscribe {
    return onValue(roomRef(code), (snap) => {
        cb(snap.exists() ? (snap.val() as T) : null);
    });
}

export function watchState<T>(code: string, cb: (value: T | null) => void): Unsubscribe {
    return onValue(stateRef(code), (snap) => {
        cb(snap.exists() ? (snap.val() as T) : null);
    });
}