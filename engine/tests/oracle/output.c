#include <stdio.h>

void print_number(int n) {
  if (n < 0) {
    putchar('-');
    if (n < -9) {
      print_number(-(n / 10));
    }
    putchar('0' - n % 10);
    return;
  }
  if (n > 9) {
    print_number(n / 10);
  }
  putchar('0' + n % 10);
}

int main(void) {
  print_number(0);
  putchar(' ');
  print_number(1234567);
  putchar(' ');
  print_number(-2147483647 - 1);
  putchar('\n');
  int written = printf("%s and %s: %d%s\n", "¡ñandú!", "", -5, "");
  printf("printf returned %d\n", written);
  printf("puts returned %d\n", puts("über"));
  printf("putchar returned %d\n", putchar(-56));
  putchar('\n');
  puts("tab\tand \"quotes\" and \\ backslash");
  puts("ab\0cd");
  return 0;
}
