#include <stdio.h>

int classify(int n) {
  switch (n % 5) {
    case 0:
      return 100;
    case 1:
    case 2:
      n = n * 2;
      /* fall through */
    case 3:
      n = n + 1;
      break;
    default:
      n = -n;
  }
  return n;
}

int main(void) {
  for (int i = 0; i < 10; i++) {
    printf("classify(%d) = %d\n", i, classify(i));
  }

  int total = 0;
  for (int i = 0; i < 6; i++) {
    if (i == 1) {
      continue;
    }
    for (int j = 0;; j++) {
      if (j > i) {
        break;
      }
      total = total + j;
    }
  }
  printf("total = %d\n", total);

  int n = 0;
  do {
    n++;
  } while (n < 0);
  printf("do runs once: %d\n", n);

  int countdown = 5;
  while (countdown) {
    printf("%d ", countdown);
    countdown--;
  }
  puts("liftoff");

  int k = 0;
  for (;;) {
    if (++k == 3) {
      break;
    }
  }
  printf("k = %d\n", k);

  if (k == 3) {
    if (n == 2)
      puts("inner");
    else
      puts("else after an if without braces");
  }
  return 0;
}
