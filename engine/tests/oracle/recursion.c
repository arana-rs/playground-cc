#include <stdio.h>

int is_odd(int n);

int is_even(int n) {
  return n == 0 ? 1 : is_odd(n - 1);
}

int is_odd(int n) {
  return n == 0 ? 0 : is_even(n - 1);
}

int gcd(int a, int b) {
  return b == 0 ? a : gcd(b, a % b);
}

int ackermann(int m, int n) {
  if (m == 0) {
    return n + 1;
  }
  if (n == 0) {
    return ackermann(m - 1, 1);
  }
  return ackermann(m - 1, ackermann(m, n - 1));
}

int hanoi(int disks, int from, int to, int via) {
  if (disks == 0) {
    return 0;
  }
  int moves = hanoi(disks - 1, from, via, to);
  printf("disk %d: %d -> %d\n", disks, from, to);
  return moves + 1 + hanoi(disks - 1, via, to, from);
}

int main(void) {
  printf("is_even(10) = %d, is_odd(7) = %d\n", is_even(10), is_odd(7));
  printf("gcd(1071, 462) = %d\n", gcd(1071, 462));
  printf("ackermann(2, 3) = %d\n", ackermann(2, 3));
  printf("moves = %d\n", hanoi(4, 1, 3, 2));
  return 0;
}
