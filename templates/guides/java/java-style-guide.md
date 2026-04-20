# Google Java Style Guide Notes

> Source: https://google.github.io/styleguide/javaguide.html

## Core Conventions

- Indent with 2 spaces, never tabs
- Use `UpperCamelCase` for classes, `lowerCamelCase` for methods and fields
- Constants use `UPPER_SNAKE_CASE`
- Prefer one top-level type per file
- Keep line length readable and wrap before expressions become visually dense

## Imports

- No wildcard imports
- Static imports come before non-static imports
- Keep imports sorted ASCII-style within each block

## Braces

- Opening brace stays on the same line
- Always use braces for `if`, `for`, `while`, and `do`

## Classes And Members

- Order members consistently: constants, fields, constructors, public methods, private helpers
- Prefer immutable fields where possible
- Document non-obvious public API behavior with Javadoc

## Naming

- Packages: lowercase, no underscores
- Types: nouns or noun phrases
- Methods: verbs or verb phrases
- Test methods: describe behavior, not implementation detail
