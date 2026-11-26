int depth(int n) {
  return depth(n + 1);
}

int main(void) {
  return depth(0);
}
