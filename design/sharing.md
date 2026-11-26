# Sharing, export and import

> Part of the [playground-cc spec](README.md). Related: [frontend](frontend.md), [security](security.md), [limits](limits.md), [frontend screens](frontend-screens.md).

How a program leaves the browser and comes back: a share link or an exported file (0.11, 1.0), and importing files (planned). Nothing leaves unless the user does it ([principles](README.md#principles)). The actions live in a menu in the top bar ([frontend screens](frontend-screens.md#10-features)).

## Share link

- **The program travels in the URL fragment**, which the browser never sends to the server ([frontend](frontend.md#one-page)): `/#c=` followed by the program's files as JSON (`{"v": 1, "files": [{"name": …, "text": …}]}`), compressed with `deflate-raw` (the browser's `CompressionStream`) and encoded as base64url. `v` is the format's version, so a later format can still open old links.
- **Only the code** travels: not the input, the console or the preferences.
- **Share** copies the link to the clipboard, or leaves it selected in a read-only field when the clipboard is not available. A program past the source size limit, or a link longer than the share link limit ([limits](limits.md#run-limits)), is not made; a notice says why, suggesting Export for a link too long.

## Opening a link

- **Never runs**: the program is loaded into the editor and runs only when the user starts it (Run, Debug or Memory, [security](security.md)).
- **Bounded at every stage** ([limits](limits.md#run-limits)):
  - a link longer than the share link limit is refused before decoding;
  - decompression counts the bytes the `DecompressionStream` produces, all chunks together, and stops once they pass the largest JSON a valid program can take: the source size limit and the longest names for the most files, every character escaped at its longest, plus the format's fixed parts;
  - the parsed program must then pass the [file-name rule](#file-names) and fit the source size limit, all texts together.
- **Refused with a notice**, leaving the editor as it was: a link too long, too large once decompressed, malformed, of an unknown version, with no files, with more files than the file limit, or with a file name the [file-name rule](#file-names) rejects.
- **The saved code** stays as it was while the shared program is only viewed ([frontend](frontend.md#saving-the-code)). The first edit asks for confirmation when the saved code is the user's own (not the hello world program and not the same as the shared one); once confirmed, the shared program replaces it, and the fragment is removed from the address bar so a reload shows the user's code.
- **A new fragment while the page is open** (`hashchange`) is opened the same way.
- **During a run, debug session or memory view session**, a link is not opened: a notice asks to stop or close it first.

## Export

- **Export** downloads the program: one file under its own name, several files (0.9) as a `.zip` of them.
- **The `.zip` needs no library**: export writes it uncompressed (stored entries), one entry per file, under its name.

## Import (planned)

- **Import** opens `.c` files, and `.cpp` and `.cc` files once C++ arrives ([roadmap](roadmap.md#in-the-roadmap)), by the file picker or by dropping them on the editor. No other format is opened: no `.h` and no `.zip`.
- **Checked before reading**: the files' sizes (`File.size`), all together, must fit the source size limit, and their number the file limit ([limits](limits.md#run-limits)); otherwise nothing is read.
- **UTF-8 only**: each file is decoded as strict UTF-8; a file that is not valid UTF-8 is refused.
- **Replaces the current program**, after a confirmation, and is saved at once like any edit. A refused file leaves the editor as it was, with a notice. Import is refused during a run, debug session or memory view session, like a link.

## File names

From 0.9 (1.0), when a program can have several files.
- ASCII letters, digits, `_`, `-` and `.`, starting with a letter, digit or `_` (never `-`, so `gcc *.c` over an export never reads a name as an option), with no `..`, at most the file-name length ([limits](limits.md#run-limits)), and ending in `.c` or `.h` (also `.cpp` and `.cc` once C++ arrives).
- In one program, names are unique, ignoring case, there is at least one file, and there are no more than the file limit ([limits](limits.md#run-limits)). The editor does not add a file past it.
- The same rule applies to links, the editor's own files and imports, which also refuse `.h` ([import](#import-planned)); a refused name is shown as text in the notice ([security](security.md)).
