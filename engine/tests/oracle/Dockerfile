# The compilers the oracle tests' expected results come from (design/testing.md#oracle-tests).
# The base is pinned by digest and the packages come from a fixed Debian snapshot, so a build
# gets the same compilers every time; changing a version is a change to this file.
FROM debian:trixie-slim@sha256:8aa5a7bf5a1955bddbe7d74fcdd0b91ab30e74362a8b73af672b0481b35b44a0

ARG SNAPSHOT=20261124T000000Z

RUN rm -f /etc/apt/sources.list.d/* \
  && printf '%s\n' \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/${SNAPSHOT} trixie main" \
    "deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/${SNAPSHOT} trixie-security main" \
    > /etc/apt/sources.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    gcc-14=14.2.0-19 \
    clang-19=1:19.1.7-3+b1 \
    libclang-rt-19-dev=1:19.1.7-3+b1 \
    libc6-dev=2.41-12+deb13u5 \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s /usr/bin/gcc-14 /usr/local/bin/gcc \
  && ln -s /usr/bin/clang-19 /usr/local/bin/clang

RUN useradd --create-home oracle
USER oracle
