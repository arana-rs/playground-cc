int sign(int n) {
  if (n > 0) {
    return 1;
  }
  if (n < 0) {
    return -1;
  }
}

int main(void) {
  return sign(0) + 1;
}
