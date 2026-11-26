#!/bin/bash
# Writes the oracle tests' expected results from native builds (design/testing.md#oracle-tests).
#
#   engine/tests/oracle/generate.sh [name...]
#
# On the host it builds the compiler image and runs itself inside it, with no network and with
# CPU, memory and time limits; with no names, it generates every case. Each `name.c` is built
# with GCC and Clang at -O0 and -O2, and run with `name.in` (if any) as stdin and `main` as
# argv[0]. The four runs must agree and write nothing to stderr, and two sanitizer builds (address
# and undefined, then memory) must run with no report; then `name.out` and `name.status` are
# written. Any other case is rejected, and the script ends with status 1.
set -eu

dir=$(cd "$(dirname "$0")" && pwd)

if [ "${ORACLE_IN_IMAGE:-}" != 1 ]; then
  image=playground-cc-oracle
  docker build --quiet --tag "$image" "$dir" >/dev/null
  exec docker run --rm --network none --cpus 2 --memory 2g --pids-limit 256 \
    --read-only --tmpfs /tmp:exec,size=512m \
    --user "$(id -u):$(id -g)" --env ORACLE_IN_IMAGE=1 \
    --volume "$dir:/oracle" --workdir /oracle \
    "$image" bash /oracle/generate.sh "$@"
fi

cd "$dir"
flags=(-std=c17 -pedantic-errors -Wall -Wextra -Werror)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
rejected=0

# Builds `$1` with the compiler and flags that follow, as $work/program.
build() {
  source=$1
  shift
  "$@" -o "$work/program" "$source" -lm 2>"$work/build.err" || {
    echo "does not build with $*:" >&2
    cat "$work/build.err" >&2
    return 1
  }
}

# Runs $work/program, writing its stdout, stderr and status to $work/$1.*.
run() {
  input=/dev/null
  [ -f "$name.in" ] && input=$name.in
  status=0
  # The wall-clock timeout comes before the CPU limit, and says so on stderr, which rejects
  # the case.
  (
    ulimit -t 15
    ulimit -f 65536
    exec timeout --verbose --kill-after=2 10 bash -c 'exec -a main "$0"' "$work/program"
  ) <"$input" >"$work/$1.out" 2>"$work/$1.err" || status=$?
  echo "$status" >"$work/$1.status"
}

# Rejects the current case.
reject() {
  echo "rejected $name.c: $1" >&2
  rejected=1
}

check() {
  name=$1
  for build in gcc-O0 gcc-O2 clang-O0 clang-O2; do
    build "$name.c" "${build%-*}" "${flags[@]}" "-${build#*-}" || return 1
    run "$build"
    if [ -s "$work/$build.err" ]; then
      reject "$build writes to stderr: $(head -c 500 "$work/$build.err")"
      return 1
    fi
  done
  for build in gcc-O2 clang-O0 clang-O2; do
    if ! cmp -s "$work/gcc-O0.out" "$work/$build.out" ||
      ! cmp -s "$work/gcc-O0.status" "$work/$build.status"; then
      reject "gcc-O0 and $build disagree"
      return 1
    fi
  done
  build "$name.c" clang "${flags[@]}" -O1 -g -fsanitize=address,undefined \
    -fno-sanitize-recover=all || return 1
  run asan
  build "$name.c" clang "${flags[@]}" -O1 -g -fsanitize=memory -fno-sanitize-recover=all || return 1
  run msan
  for build in asan msan; do
    if [ -s "$work/$build.err" ] || ! cmp -s "$work/gcc-O0.out" "$work/$build.out" ||
      ! cmp -s "$work/gcc-O0.status" "$work/$build.status"; then
      reject "the $build build reports: $(head -c 500 "$work/$build.err")"
      return 1
    fi
  done
  cp "$work/gcc-O0.out" "$name.out"
  cp "$work/gcc-O0.status" "$name.status"
  echo "wrote $name.out and $name.status"
}

if [ $# -eq 0 ]; then
  shopt -s nullglob
  files=(*.c)
  set -- "${files[@]%.c}"
fi
for name in "$@"; do
  check "$name" || rejected=1
done
exit "$rejected"
