#include <stdio.h>

int twice(int x) {
  x = x * 2;
  return x;
}

int main(void) {
  int x = 1;
  {
    int x = 2;
    printf("inner x = %d\n", x);
    {
      int x;
      x = 3;
      printf("innermost x = %d\n", x);
    }
  }
  printf("outer x = %d\n", x);
  for (int x = 10; x < 12; x++) {
    printf("loop x = %d\n", x);
  }
  printf("twice(x) = %d, x = %d\n", twice(x), x);
  int y;
  if (x) {
    y = 5;
  } else {
    y = 6;
  }
  printf("y = %d\n", y);
  return 0;
}
