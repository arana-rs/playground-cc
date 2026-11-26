#include <stdio.h>

int show(int value) {
  printf("%d\n", value);
  return value;
}

int main(void) {
  show(7 / 2);
  show(-7 / 2);
  show(7 / -2);
  show(-7 % 2);
  show(7 % -2);
  show(2 + 3 * 4 - 10 / 3 % 2);
  show((2 + 3) * (4 - 10) / 3);
  show(-2147483647 - 1);
  show(2147483647);
  show(-(-2147483647));
  show(46340 * 46340);
  show(-2147483647 / -1);
  show((1 < 2) == 1);
  show((3 > 2) > 1);
  show(!0 + !5 + !!7);

  int a = 10;
  a += 5;
  a -= 3;
  a *= 4;
  a /= 5;
  a %= 7;
  show(a);
  int b = a++ + 10;
  show(a);
  show(b);
  b = --a * 2;
  show(a);
  show(b);
  show(a = b = 9);

  int calls = 0;
  int r = (calls = calls + 1, 0) && (calls = calls + 10, 1);
  show(r);
  show(calls);
  r = (calls = calls + 100, 1) || (calls = calls + 1000, 1);
  show(r);
  show(calls);
  show(calls > 100 ? calls - 100 : -1);
  show((a = 1, b = a + 1, a + b));
  show('A' + 1);
  show('\n' + '\t' * 2 + '\0');
  return 0;
}
