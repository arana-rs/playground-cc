#include <stdio.h>

int steps(int n) {
  int count = 0;
  while (n != 1) {
    n = n % 2 == 0 ? n / 2 : 3 * n + 1;
    count++;
  }
  return count;
}

int main(void) {
  int best = 1;
  int longest = 0;
  for (int n = 1; n < 3000; n++) {
    int s = steps(n);
    if (s > longest) {
      longest = s;
      best = n;
    }
  }
  printf("%d takes %d steps\n", best, longest);
  return 0;
}
