// The standard library as the checker sees it: the subset's functions, by header, and the name of
// every other C17 library function (design/libc.md#headers-and-functions).

/** A parameter type a library function takes: `string` is a `const char *`. */
export type LibraryParameter = 'int' | 'string';

export interface LibraryFunction {
  name: string;
  returns: 'int' | 'void';
  params: LibraryParameter[];
  variadic: boolean;
}

/** The functions each supported header declares in 0.1. */
export const HEADER_FUNCTIONS: ReadonlyMap<string, readonly LibraryFunction[]> = new Map([
  [
    'stdio.h',
    [
      { name: 'printf', returns: 'int', params: ['string'], variadic: true },
      { name: 'putchar', returns: 'int', params: ['int'], variadic: false },
      { name: 'puts', returns: 'int', params: ['string'], variadic: false },
    ],
  ],
  ['stdlib.h', [{ name: 'exit', returns: 'void', params: ['int'], variadic: false }]],
]);

export const SUBSET_FUNCTIONS: ReadonlyMap<string, LibraryFunction> = new Map(
  [...HEADER_FUNCTIONS.values()].flat().map((fn) => [fn.name, fn]),
);

/** `name`, `namef` and `namel`: the `<math.h>` and `<complex.h>` families. */
const withFloatVariants = (names: string): string[] =>
  names.split(' ').flatMap((name) => [name, `${name}f`, `${name}l`]);

/** Every C17 library function, and function-like macro, by its name (Annex K excluded). */
const C17_NAMES = [
  'assert',
  ...withFloatVariants(
    'cabs cacos cacosh carg casin casinh catan catanh ccos ccosh cexp cimag clog conj cpow cproj creal csin csinh csqrt ctan ctanh',
  ),
  ...'CMPLX CMPLXF CMPLXL'.split(' '),
  ...'isalnum isalpha isblank iscntrl isdigit isgraph islower isprint ispunct isspace isupper isxdigit tolower toupper'.split(
    ' ',
  ),
  ...'feclearexcept fegetexceptflag feraiseexcept fesetexceptflag fetestexcept fegetround fesetround fegetenv feholdexcept fesetenv feupdateenv'.split(
    ' ',
  ),
  ...'imaxabs imaxdiv strtoimax strtoumax wcstoimax wcstoumax setlocale localeconv'.split(' '),
  ...withFloatVariants(
    'acos asin atan atan2 cos sin tan acosh asinh atanh cosh sinh tanh exp exp2 expm1 frexp ilogb ldexp log log10 log1p log2 logb modf scalbn scalbln cbrt fabs hypot pow sqrt erf erfc lgamma tgamma ceil floor nearbyint rint lrint llrint round lround llround trunc fmod remainder remquo copysign nan nextafter nexttoward fdim fmax fmin fma',
  ),
  ...'fpclassify isfinite isinf isnan isnormal signbit isgreater isgreaterequal isless islessequal islessgreater isunordered'.split(
    ' ',
  ),
  ...'setjmp longjmp signal raise va_start va_arg va_end va_copy offsetof'.split(' '),
  ...'atomic_init atomic_thread_fence atomic_signal_fence atomic_is_lock_free kill_dependency atomic_flag_test_and_set atomic_flag_test_and_set_explicit atomic_flag_clear atomic_flag_clear_explicit'.split(
    ' ',
  ),
  ...'store load exchange compare_exchange_strong compare_exchange_weak fetch_add fetch_sub fetch_or fetch_xor fetch_and'
    .split(' ')
    .flatMap((name) => [`atomic_${name}`, `atomic_${name}_explicit`]),
  ...'remove rename tmpfile tmpnam fclose fflush fopen freopen setbuf setvbuf fprintf fscanf printf scanf snprintf sprintf sscanf vfprintf vfscanf vprintf vscanf vsnprintf vsprintf vsscanf fgetc fgets fputc fputs getc getchar putc putchar puts ungetc fread fwrite fgetpos fseek fsetpos ftell rewind clearerr feof ferror perror'.split(
    ' ',
  ),
  ...'atof atoi atol atoll strtod strtof strtold strtol strtoll strtoul strtoull rand srand aligned_alloc calloc free malloc realloc abort atexit at_quick_exit exit _Exit getenv quick_exit system bsearch qsort abs labs llabs div ldiv lldiv mblen mbtowc wctomb mbstowcs wcstombs'.split(
    ' ',
  ),
  ...'memcpy memmove strcpy strncpy strcat strncat memcmp strcmp strcoll strncmp strxfrm memchr strchr strcspn strpbrk strrchr strspn strstr strtok memset strerror strlen'.split(
    ' ',
  ),
  ...'call_once cnd_broadcast cnd_destroy cnd_init cnd_signal cnd_timedwait cnd_wait mtx_destroy mtx_init mtx_lock mtx_timedlock mtx_trylock mtx_unlock thrd_create thrd_current thrd_detach thrd_equal thrd_exit thrd_join thrd_sleep thrd_yield tss_create tss_delete tss_get tss_set'.split(
    ' ',
  ),
  ...'clock difftime mktime time timespec_get asctime ctime gmtime localtime strftime mbrtoc16 c16rtomb mbrtoc32 c32rtomb'.split(
    ' ',
  ),
  ...'fwprintf fwscanf swprintf swscanf vfwprintf vfwscanf vswprintf vswscanf vwprintf vwscanf wprintf wscanf fgetwc fgetws fputwc fputws fwide getwc getwchar putwc putwchar ungetwc wcstod wcstof wcstold wcstol wcstoll wcstoul wcstoull wcscpy wcsncpy wmemcpy wmemmove wcscat wcsncat wcscmp wcscoll wcsncmp wcsxfrm wmemcmp wcschr wcscspn wcspbrk wcsrchr wcsspn wcsstr wcstok wmemchr wcslen wmemset wcsftime btowc wctob mbsinit mbrlen mbrtowc wcrtomb mbsrtowcs wcsrtombs'.split(
    ' ',
  ),
  ...'iswalnum iswalpha iswblank iswcntrl iswdigit iswgraph iswlower iswprint iswpunct iswspace iswupper iswxdigit iswctype wctype towlower towupper towctrans wctrans'.split(
    ' ',
  ),
];

/** A C17 library function outside the subset: `unsupported.function` when the program uses it. */
export function isUnsupportedFunction(name: string): boolean {
  return C17_SET.has(name) && !SUBSET_FUNCTIONS.has(name);
}

const C17_SET: ReadonlySet<string> = new Set(C17_NAMES);
