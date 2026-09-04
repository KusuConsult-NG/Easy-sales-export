import crypto from "crypto";
import { CLASSROOM_ROOM_KEY_BYTES, isMintedRoomKey } from "@/lib/classroom-room";

/**
 * Minting a classroom room key — #188.
 *
 * Separate from lib/classroom-room.ts because that module is the RULE and
 * imports nothing (#381), while this one needs node:crypto and can therefore
 * only run on the server. Keeping them apart is also what stops a room key
 * from ever being generated in the browser, which would put the secret in the
 * one place the person who must not have it is sitting.
 */

/** A fresh 128-bit room key: 32 lowercase hex characters. */
export function mintClassroomRoomKey(): string {
    return crypto.randomBytes(CLASSROOM_ROOM_KEY_BYTES).toString("hex");
}

/**
 * The key an existing session row should use.
 *
 * A row written before #188 has no `roomKey` — or has one of the derived names
 * that were the defect — so it gets a real one the first time a moderator
 * starts the class. Nothing is destroyed: the old `roomName` field stays on the
 * row exactly as it was, it simply stops being what opens the classroom.
 *
 * An existing MINTED key is kept, so re-starting a class does not throw the
 * people already in the room out of it.
 */
export function roomKeyFor(existing: unknown): string {
    return isMintedRoomKey(existing) ? existing : mintClassroomRoomKey();
}
