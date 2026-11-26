#include <stdio.h>
#include <stdlib.h>

void finish(int code) {
  printf("finishing with %d\n", code);
  exit(code + 255);
}

int main(void) {
  finish(45);
  puts("never printed");
  return EXIT_SUCCESS;
}
