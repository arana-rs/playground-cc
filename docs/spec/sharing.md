# Sharing, export and import

> Part of the [playground-cc spec](../spec.md). Related: [frontend](frontend.md), [security](security.md), [limits](limits.md), [frontend screens](frontend-screens.md).

How a program leaves the browser and comes back (0.11, 1.0): a share link, or files. Nothing leaves unless the user does it ([principles](../spec.md#principles)). The actions live in a menu in the top bar ([frontend screens](frontend-screens.md#10-features)).

## Share link

- **The program travels in the URL fragment**, which the browser never sends to the server ([frontend](frontend.md#one-page)): `/#c=` followed by the program's files as JSON (`{"v": 1, "files": [{"name": …, "text": …}]}`), compressed with `deflate-raw` (the browser's `CompressionStream`) and encoded as base64url. `v` is the format's version, so a later format can still open old links.
- **Only the code** travels: not the input, the console or the preferences.
- **Share** copies the link to the clipboard, or leaves it selected in a read-only field when the clipboard is not available. A link longer than the share link limit ([limits](limits.md#run-limits)) is not made; a notice suggests Export instead.

## Opening a link

- **Never runs**: the program is loaded into the editor and runs only when the user presses Run ([security](security.md)).
- **Bounded at every stage**: a fragment longer than the share link limit is refused before decoding; decompression stops once it passes the source size limit plus a fixed margin for the JSON around the code; the file texts together must then fit the source size limit ([limits](limits.md#run-limits)).
- **Refused with a notice**, leaving the editor as it was: a link too long, malformed, of an unknown version, with no files, or with a file name the [file-name rule](#file-names) rejects.
- **The saved code** stays as it was while the shared program is only viewed ([frontend](frontend.md#saving-the-code)). The first edit asks for confirmation when the saved code is the user's own (not the hello world program and not the same as the shared one); once confirmed, the shared program replaces it, and the fragment is removed from the address bar so a reload shows the user's code.
- **A new fragment while the page is open** (`hashchange`) is opened the same way.
- **During a run, debug session or memory view session**, a link is not opened: a notice asks to stop or close it first.

## Export and import

- **Export** downloads the program: one file under its own name, several files (0.9) as a `.zip` of them.
- **Import** opens `.c` and `.h` files, or a `.zip` of them, by the file picker or by dropping them on the editor. It replaces the current program, after a confirmation, and is saved at once like any edit. It is refused during a run, debug session or memory view session, like a link.
- **The `.zip` needs no library**: export writes it uncompressed (stored entries); import reads its central directory and inflates each entry with the browser's `DecompressionStream`, under the same bounds as a link. Folders and `__MACOSX/` entries are skipped; any other entry must pass the file-name rule.

## File names

- ASCII letters, digits, `_`, `-` and `.`, starting with a letter, digit, `_` or `-`, with no `..`, and ending in `.c` or `.h`.
- In one program, names are unique, ignoring case, and there is at least one file.
- The same rule applies to links and imports; a refused name is shown as text in the notice ([security](security.md)).
