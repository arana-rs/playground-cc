#include <stdio.h>

int is_prime(int n) {
  if (n < 2) {
    return 0;
  }
  for (int d = 2; d * d <= n; d++) {
    if (n % d == 0) {
      return 0;
    }
  }
  return 1;
}

int main(void) {
  int count = 0;
  for (int n = 0; n < 300; n++) {
    if (is_prime(n)) {
      count++;
      printf("%d", n);
      putchar(count % 10 == 0 ? '\n' : ' ');
    }
  }
  printf("\n%d primes\n", count);
  return count;
}
