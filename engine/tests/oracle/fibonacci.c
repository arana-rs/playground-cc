#include <stdio.h>

int fib(int n) {
  if (n < 2) {
    return n;
  }
  return fib(n - 1) + fib(n - 2);
}

int main(void) {
  for (int i = 0; i <= 24; i++) {
    printf("fib(%d) = %d\n", i, fib(i));
  }
  return 0;
}
