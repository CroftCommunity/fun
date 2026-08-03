//! Pure outcome/share logic for Align — no DOM. The verifiable claim: "on seed X
//! this tick-stamped action stream, under this mode, reached score S (and, if
//! won, the goal)." Verification itself runs in the core (the Rust
//! `pond_outcome::verify` via `Align.verifyShared`), so nothing is trusted — this
//! module only shuttles the record in and out of the `?r=` share.

import { decodeShare, encodeShare } from "../share.js";

/** A `pond_outcome::Record` for Align as it crosses the boundary. The `moves`
 *  are opaque here (a `Begin` header + tick-stamped events); the core replays. */
export interface AlignRecord {
  kind: string;
  seed: number;
  moves: unknown[];
  move_count: number;
  final_hash: string;
  result: "Won" | "Lost" | "Stuck" | "Abandoned";
  assistance: boolean | null;
  score?: number;
}

/** A `pond-docformat` envelope wrapping an [`AlignRecord`]. */
export interface AlignEnvelope {
  kind: string;
  version: number;
  payload: AlignRecord;
}

/** Encode an Align outcome envelope as the `?r=` share payload (deflated). */
export async function encodeRecord(env: AlignEnvelope): Promise<string> {
  return encodeShare(env);
}

/** Decode a `?r=` share payload back into an Align outcome envelope. */
export async function decodeRecord(payload: string): Promise<AlignEnvelope> {
  return decodeShare<AlignEnvelope>(payload);
}
