//! `tools/stale-shots.sh` — the landing-time reminder that a game whose look
//! changed regenerates its how-to shots. PR #79 (2026-09-05) resized eight
//! boards and shipped with every shot of them stale; the guide is data the
//! player reads, so a stale shot is a wrong instruction. The check reads the
//! branch's diff against `origin/main`: a change under `src/games/<id>/` (or
//! `src/games/<id>.ts`) that is not only how-to copy or tests wants a change to
//! `assets/guide/<id>-*.jpg` in the same range. No `origin/main` (CI's shallow
//! checkout) means nothing to compare: it says so and passes.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "tools", "stale-shots.sh");

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

/** A throwaway repo with an `origin/main` ref and one game with shots. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "stale-shots-"));
  git(dir, "init", "-q", "-b", "main");
  mkdirSync(join(dir, "src", "games", "chess"), { recursive: true });
  mkdirSync(join(dir, "assets", "guide"), { recursive: true });
  writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "src", "games", "chess", "chess-howto.ts"), "export const copy = 1;\n");
  writeFileSync(join(dir, "assets", "guide", "chess-board.jpg"), "jpg1");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  return dir;
}

function run(dir: string): { status: number; out: string } {
  try {
    return { status: 0, out: execFileSync("bash", [SCRIPT], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    const err = e as { status: number; stdout: string; stderr: string };
    return { status: err.status, out: `${err.stdout}${err.stderr}` };
  }
}

describe("tools/stale-shots.sh", () => {
  it("passes when nothing under a game changed", () => {
    const dir = repo();
    expect(run(dir).status).toBe(0);
  });

  it("fails, naming the game, when a game's module changed and none of its shots did", () => {
    const dir = repo();
    writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 2;\n");
    git(dir, "commit", "-qam", "chess: something visible");
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/chess/);
    expect(r.out).toMatch(/assets\/guide\/chess-/);
  });

  it("passes when the game's shots changed in the same range", () => {
    const dir = repo();
    writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "assets", "guide", "chess-board.jpg"), "jpg2");
    git(dir, "commit", "-qam", "chess: something visible, shots regenerated");
    expect(run(dir).status).toBe(0);
  });

  it("how-to copy alone is not a look change", () => {
    const dir = repo();
    writeFileSync(join(dir, "src", "games", "chess", "chess-howto.ts"), "export const copy = 2;\n");
    git(dir, "commit", "-qam", "chess: copy");
    expect(run(dir).status).toBe(0);
  });

  it("with no origin/main to compare against it says so and passes — CI's shallow checkout is not a stale shot", () => {
    const dir = repo();
    git(dir, "update-ref", "-d", "refs/remotes/origin/main");
    writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 2;\n");
    git(dir, "commit", "-qam", "chess: something visible");
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/origin\/main/);
  });

  it("a commit in the range saying `Shots-Unchanged: <id> — <why>` is an audited pass for that game", () => {
    // A slide beat is a transient no still shot can show: the module changed, the
    // look in a shot did not, and the author says so where a reader can find it.
    const dir = repo();
    writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 2;\n");
    git(dir, "commit", "-qam", "chess: a slide beat\n\nShots-Unchanged: chess — the slide is a transient no still shot shows");
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/chess.*Shots-Unchanged/);
  });

  it("the trailer covers only the game it names", () => {
    const dir = repo();
    mkdirSync(join(dir, "src", "games", "dots"), { recursive: true });
    writeFileSync(join(dir, "src", "games", "dots", "dots.ts"), "export const d = 1;\n");
    writeFileSync(join(dir, "assets", "guide", "dots-board.jpg"), "jpg");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "dots: base");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "src", "games", "chess", "chess.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "src", "games", "dots", "dots.ts"), "export const d = 2;\n");
    git(dir, "commit", "-qam", "both\n\nShots-Unchanged: chess — a transient");
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/dots changed/);
  });
});
