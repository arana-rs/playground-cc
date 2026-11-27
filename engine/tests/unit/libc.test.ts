import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../src/diagnostic';
import { LIMITS, type Limits } from '../../src/limits';
import { Run } from '../../src/run';

/** Runs a program in slices of `slice` steps: its output, and its status or diagnostic. */
function run(
  body: string,
  limits: Partial<Limits> = {},
  slice = 3,
): { output: string; status?: number; diagnostic?: Diagnostic } {
  const text = `#include <stdio.h>\nint main(void) {\n${body}\n}\n`;
  const r = new Run({ files: [{ name: 'main.c', text }], limits: { ...LIMITS, ...limits } });
  const bytes: number[] = [];
  for (;;) {
    const state = r.advance(slice);
    bytes.push(...r.takeOutput());
    if (state.state === 'ended') {
      const output = new TextDecoder().decode(Uint8Array.from(bytes));
      const { end } = state;
      return end.reason === 'exit'
        ? { output, status: end.status }
        : { output, diagnostic: end.diagnostic };
    }
  }
}

const at = (line: number, start: number, end: number) => ({
  file: 'main.c',
  start: { line, column: start },
  end: { line, column: end },
});

describe('printf, putchar and puts', () => {
  it('write their output and return what glibc returns', () => {
    expect(run('return printf("n=%d s=%s|%d\\n", -42, "ok", 2147483647);')).toEqual({
      output: 'n=-42 s=ok|2147483647\n',
      status: 22,
    });
    expect(run('return puts("ab");')).toEqual({ output: 'ab\n', status: 3 });
    expect(run('return putchar(65) + putchar(-1) - 255 + putchar(256 + 66);')).toEqual({
      output: 'A\uFFFDB',
      status: (65 + 66) % 256,
    });
  });

  it('write UTF-8 bytes as they are, and stop at a null byte', () => {
    expect(run('printf("¡%s!\\n", "ñandú");').output).toBe('¡ñandú!\n');
    expect(run('return printf("a\\0%d") + puts("b\\0c");')).toEqual({ output: 'ab\n', status: 3 });
    expect(run('return printf("%s|", "x\\0y");')).toEqual({ output: 'x|', status: 2 });
  });

  it('evaluate and ignore extra arguments', () => {
    expect(run('int i = 0; printf("%d", 1, i = 5); return i;')).toEqual({ output: '1', status: 5 });
  });

  it('charge one step per byte read or written, across slices', () => {
    // The smallest step budget the program ends in.
    const steps = (body: string) => {
      const text = `#include <stdio.h>\nint main(void) { ${body} }\n`;
      const ended = (limit: number) => {
        const r = new Run({
          files: [{ name: 'main.c', text }],
          limits: { ...LIMITS, steps: limit },
        });
        let state = r.advance(1);
        while (state.state === 'running') state = r.advance(1);
        return state.end.reason === 'exit';
      };
      let low = 0;
      let high = 10_000;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ended(mid)) high = mid;
        else low = mid + 1;
      }
      return low;
    };
    // Programs of the same shape: the differences are the library's steps alone.
    const empty = steps('printf("", 12, ""); return 0;');
    // `ab`, `%d`, `12`, `%s` and `xyz`.
    expect(steps('printf("ab%d%s", 12, "xyz"); return 0;') - empty).toBe(2 + 2 + 2 + 2 + 3);
    // Each byte of the string, then the newline; `putchar` writes one byte like it.
    expect(steps('puts("ab"); return 0;') - steps('puts(""); return 0;')).toBe(2);
    expect(steps('putchar(1); return 0;') - steps('puts(""); return 0;')).toBe(0);
  });

  it('stop at the output limit with exactly the limit written', () => {
    expect(run('while (1) puts("0123456");', { output: 20 })).toMatchObject({
      output: '0123456\n0123456\n0123',
      diagnostic: {
        code: 'limit.output',
        args: { limit: 20 },
        range: at(3, 11, 26),
        stack: { frames: [{ function: 'main', range: at(3, 11, 26) }], total: 1 },
      },
    });
    expect(run('putchar(1);', { output: 0 }).diagnostic?.code).toBe('limit.output');
    expect(run('printf("%d", 123);', { output: 2 })).toMatchObject({
      output: '12',
      diagnostic: { code: 'limit.output' },
    });
  });
});

describe('printf format checks', () => {
  const check = (body: string) => {
    const { output, diagnostic } = run(body);
    return { output, code: diagnostic?.code, args: diagnostic?.args, range: diagnostic?.range };
  };

  it('stops at a malformed conversion, after the text before it', () => {
    expect(check('printf("ab%y", 1);')).toEqual({
      output: 'ab',
      code: 'ub.format_invalid',
      args: { conversion: '%y' },
      range: at(3, 8, 14),
    });
    for (const [format, conversion] of [
      ['%', '%'],
      ['%5', '%5'],
      ['%#d', '%#d'],
      ['%0s', '%0s'],
      ['%.3c', '%.3c'],
      ['%hs', '%hs'],
      ['%Ld', '%Ld'],
      ['%5n', '%5n'],
      ['%-%', '%-%'],
      ['%5.3.d', '%5.3.'],
      ['%é', '%é'],
      ['%\\xff', '%\ufffd'],
      ['%\\0d', '%'],
    ]) {
      expect(check(`printf("${format}", 1);`), format).toMatchObject({
        code: 'ub.format_invalid',
        args: { conversion },
      });
    }
  });

  it('stops at a valid conversion outside the subset', () => {
    for (const conversion of ['%%', '%i', '%u', '%x', '%c', '%f', '%p', '%n', '%Lf', '%5d']) {
      expect(check(`printf("${conversion}", 1);`), conversion).toMatchObject({
        code: 'unsupported.conversion',
        args: { conversion },
      });
    }
    for (const conversion of ['%-d', '%+d', '% d', '%05d', '%.2s', '%*d', '%ld', '%lld', '%zd']) {
      expect(check(`printf("${conversion}", 1);`).code, conversion).toBe('unsupported.conversion');
    }
  });

  it('stops at a missing argument at the call', () => {
    expect(check('printf("%d-%d", 1);')).toEqual({
      output: '1-',
      code: 'ub.format_missing_argument',
      args: { conversion: '%d' },
      range: at(3, 1, 19),
    });
  });

  it('stops at an argument of the wrong type at the argument', () => {
    expect(check('printf("%d", "hi");')).toMatchObject({
      code: 'ub.format_mismatch',
      args: { conversion: '%d', type: 'char *' },
      range: at(3, 14, 18),
    });
    expect(check('printf("%s", 5);')).toMatchObject({
      code: 'ub.format_mismatch',
      args: { conversion: '%s', type: 'int' },
      range: at(3, 14, 15),
    });
  });
});

describe('library calls, edge cases', () => {
  it('return bytes, not characters, and print the int range', () => {
    expect(run('return printf("¡%s!\\n", "ñandú") * 10 + puts("ñ");').status).toBe(113);
    expect(run('printf("%d %d", -2147483647 - 1, 0);').output).toBe('-2147483648 0');
  });

  it('stop at the output limit inside a string or before the newline', () => {
    expect(run('puts("ab");', { output: 2 })).toMatchObject({
      output: 'ab',
      diagnostic: { code: 'limit.output' },
    });
    expect(run('printf("%s", "abcd");', { output: 2 })).toMatchObject({
      output: 'ab',
      diagnostic: { code: 'limit.output' },
    });
  });

  it('keep what they wrote when the steps run out in the middle of a call', () => {
    const text = '#include <stdio.h>\nint main(void) { puts("abcdefghij"); }\n';
    const ended = (steps: number) => {
      const r = new Run({ files: [{ name: 'main.c', text }], limits: { ...LIMITS, steps } });
      let state = r.advance(1);
      let output = '';
      for (;;) {
        output += new TextDecoder().decode(r.takeOutput());
        if (state.state === 'ended') return { output, end: state.end };
        state = r.advance(1);
      }
    };
    const full = 'abcdefghij\n';
    const outputs = new Set<string>();
    for (let steps = 1; ; steps++) {
      const { output, end } = ended(steps);
      if (end.reason === 'exit') break;
      expect(end.diagnostic.code).toBe('limit.steps');
      expect(full.startsWith(output)).toBe(true);
      // Stopped inside the call: at the call, with the bytes before that step written.
      if (output !== '' && output !== full) expect(end.diagnostic.range).toEqual(at(2, 18, 36));
      outputs.add(output);
    }
    expect([...outputs].sort()).toEqual(
      Array.from({ length: full.length + 1 }, (_, n) => full.slice(0, n)).sort(),
    );
  });

  it('check a conversion before its argument', () => {
    expect(run('printf("%5d");').diagnostic?.code).toBe('unsupported.conversion');
    expect(run('printf("%y");').diagnostic?.code).toBe('ub.format_invalid');
  });

  it('tell valid conversions outside the subset from malformed ones', () => {
    for (const conversion of [
      '%lc',
      '%ls',
      '%lf',
      '%ln',
      '%.d',
      '%.*d',
      '%0*d',
      '%#x',
      '%-05d',
      '%+ 5d',
    ]) {
      expect(run(`printf("${conversion}", 1);`).diagnostic?.code, conversion).toBe(
        'unsupported.conversion',
      );
    }
    for (const conversion of ['%#u', '%0p', '%.2p', '%lp', '%Ln', '%-n', '%*5d', '%llld']) {
      expect(run(`printf("${conversion}", 1);`).diagnostic?.code, conversion).toBe(
        'ub.format_invalid',
      );
    }
  });

  it('cut a long conversion to the text length', () => {
    const conversion = `%${'-'.repeat(300)}y`;
    const args = run(`printf("${conversion}");`).diagnostic?.args;
    expect(args).toEqual({ conversion: `%${'-'.repeat(198)}…` });
  });

  it('report the whole stack from inside a function', () => {
    const text =
      '#include <stdio.h>\nint show(int n) { return printf("%s", n); }\nint main(void) { return show(1); }\n';
    const r = new Run({ files: [{ name: 'main.c', text }], limits: LIMITS });
    let state = r.advance(1000);
    while (state.state === 'running') state = r.advance(1000);
    expect(state.end).toMatchObject({
      reason: 'diagnostic',
      diagnostic: {
        code: 'ub.format_mismatch',
        range: at(2, 39, 40),
        stack: {
          frames: [
            { function: 'show', range: at(2, 39, 40) },
            { function: 'main', range: at(3, 25, 32) },
          ],
          total: 2,
        },
      },
    });
  });
});
