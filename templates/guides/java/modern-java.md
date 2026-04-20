# Modern Java Features

> Sources: https://openjdk.org/jeps/ (JEP 431, 440, 441, 444)

## Virtual Threads (JEP 444)

Virtual Threads are lightweight threads managed by the JVM, enabling millions of concurrent tasks without thread pool tuning.

### Key Properties

| Property | Platform Thread | Virtual Thread |
|----------|----------------|----------------|
| Creation cost | High (OS thread) | Low (JVM-managed) |
| Memory footprint | ~1MB per thread | ~few KB |
| Blocking behavior | Blocks OS thread | Unmounts carrier thread |
| Pooling | Needed | Not recommended |

### Usage

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<String>> futures = IntStream.range(0, 10_000)
        .mapToObj(i -> executor.submit(() -> fetchData(i)))
        .toList();
}

Thread.ofVirtual().name("vt-worker").start(() -> processRequest());
```

## Pattern Matching

```java
if (obj instanceof String s && !s.isEmpty()) {
    return s.toUpperCase();
}

String format = switch (obj) {
    case Integer i -> "int %d".formatted(i);
    case String s -> "string %s".formatted(s);
    case null -> "null";
    default -> obj.toString();
};
```

## Records

```java
record Point(int x, int y) {}

record Range(int min, int max) {
    Range {
        if (min > max) {
            throw new IllegalArgumentException("min > max");
        }
    }
}
```

## Sealed Types

```java
sealed interface Shape permits Circle, Rectangle {}

record Circle(double radius) implements Shape {}
record Rectangle(double width, double height) implements Shape {}
```

## Sequenced Collections

- Prefer `getFirst()` / `getLast()` over index arithmetic for ordered collections
- Use `reversed()` when reverse traversal is the intent
