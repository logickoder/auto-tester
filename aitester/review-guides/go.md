# Go Code Review Guide

A code review checklist based on the official Go guidance, Effective Go, and community best practice.

> Applies to `zedu-hng/zedu-be` and any other Go PR. The general rules in `../AGENTS.md` (scope, output format, attribution, bundle PRs) still apply; this guide only adds language-specific checks. Translated from the original Chinese guide.

## Quick review checklist

### Must check
- [ ] Are errors handled correctly (not ignored, with context)?
- [ ] Does every goroutine have a way to exit (no leaks)?
- [ ] Is `context` passed through and cancelled correctly?
- [ ] Is the receiver type (value vs pointer) chosen sensibly?
- [ ] Is the code formatted with `gofmt`?

### Frequent problems
- [ ] Loop-variable capture (Go < 1.22)
- [ ] Incomplete nil checks
- [ ] Maps used before initialisation
- [ ] `defer` inside loops
- [ ] Variable shadowing

---

## 1. Error handling

### 1.1 Never ignore errors

```go
// ❌ Wrong: error ignored
result, _ := SomeFunction()

// ✅ Right: handle the error
result, err := SomeFunction()
if err != nil {
    return fmt.Errorf("some function failed: %w", err)
}
```

### 1.2 Wrap errors with context

```go
// ❌ Wrong: context lost
if err != nil {
    return err
}

// ❌ Wrong: %v breaks the error chain
if err != nil {
    return fmt.Errorf("failed: %v", err)
}

// ✅ Right: %w keeps the error chain
if err != nil {
    return fmt.Errorf("failed to process user %d: %w", userID, err)
}
```

### 1.3 Use errors.Is and errors.As

```go
// ❌ Wrong: direct comparison (does not see wrapped errors)
if err == sql.ErrNoRows {
    // ...
}

// ✅ Right: errors.Is follows the error chain
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}

// ✅ Right: errors.As extracts a specific type
var pathErr *os.PathError
if errors.As(err, &pathErr) {
    log.Printf("path error: %s", pathErr.Path)
}
```

### 1.4 Custom error types

```go
// ✅ Recommended: sentinel errors
var (
    ErrNotFound     = errors.New("not found")
    ErrUnauthorized = errors.New("unauthorized")
)

// ✅ Recommended: custom errors that carry context
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on %s: %s", e.Field, e.Message)
}
```

### 1.5 Handle an error only once

```go
// ❌ Wrong: log and return (handled twice)
if err != nil {
    log.Printf("error: %v", err)
    return err
}

// ✅ Right: only return; let the caller decide
if err != nil {
    return fmt.Errorf("operation failed: %w", err)
}

// ✅ Or: only log and handle (do not return)
if err != nil {
    log.Printf("non-critical error: %v", err)
    // continue with fallback logic
}
```

---

## 2. Concurrency and goroutines

### 2.1 Avoid goroutine leaks

```go
// ❌ Wrong: the goroutine can never exit
func bad() {
    ch := make(chan int)
    go func() {
        val := <-ch // blocks forever; nobody sends
        fmt.Println(val)
    }()
    // function returns; goroutine leaks
}

// ✅ Right: use a context or a done channel
func good(ctx context.Context) {
    ch := make(chan int)
    go func() {
        select {
        case val := <-ch:
            fmt.Println(val)
        case <-ctx.Done():
            return // clean exit
        }
    }()
}
```

### 2.2 Channel rules

```go
// ❌ Wrong: sending on a nil channel (blocks forever)
var ch chan int
ch <- 1 // blocks forever

// ❌ Wrong: sending on a closed channel (panic)
close(ch)
ch <- 1 // panic!

// ✅ Right: the sender closes the channel
func producer(ch chan<- int) {
    defer close(ch) // the sender is responsible for closing
    for i := 0; i < 10; i++ {
        ch <- i
    }
}

// ✅ Right: the receiver detects closing
for val := range ch {
    process(val)
}
// or
val, ok := <-ch
if !ok {
    // channel is closed
}
```

### 2.3 Using sync.WaitGroup

```go
// ❌ Wrong: Add inside the goroutine
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1) // race condition!
        defer wg.Done()
        work()
    }()
}
wg.Wait()

// ✅ Right: Add before starting the goroutine
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

### 2.4 Do not capture the loop variable (Go < 1.22)

```go
// ❌ Wrong (Go < 1.22): captures the loop variable
for _, item := range items {
    go func() {
        process(item) // every goroutine may see the same item
    }()
}

// ✅ Right: pass it as a parameter
for _, item := range items {
    go func(it Item) {
        process(it)
    }(item)
}

// ✅ Go 1.22+: fixed by default; each iteration gets a new variable
```

Check the `go` directive in `go.mod` before flagging this.

### 2.5 Worker pool pattern

```go
// ✅ Recommended: bound the number of concurrent workers
func processWithWorkerPool(ctx context.Context, items []Item, workers int) error {
    jobs := make(chan Item, len(items))
    results := make(chan error, len(items))

    // start the workers
    for w := 0; w < workers; w++ {
        go func() {
            for item := range jobs {
                results <- process(item)
            }
        }()
    }

    // send the jobs
    for _, item := range items {
        jobs <- item
    }
    close(jobs)

    // collect the results
    for range items {
        if err := <-results; err != nil {
            return err
        }
    }
    return nil
}
```

---

## 3. Using context

### 3.1 Context is the first parameter

```go
// ❌ Wrong: context is not the first parameter
func Process(data []byte, ctx context.Context) error

// ❌ Wrong: context stored in a struct
type Service struct {
    ctx context.Context // do not do this!
}

// ✅ Right: context first, named ctx
func Process(ctx context.Context, data []byte) error
```

### 3.2 Propagate; do not create a new root context

```go
// ❌ Wrong: a new root context in the middle of the call chain
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := context.Background() // loses the request's context!
        process(ctx)
        next.ServeHTTP(w, r)
    })
}

// ✅ Right: take it from the request and pass it on
func middleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        ctx := r.Context()
        ctx = context.WithValue(ctx, key, value)
        process(ctx)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

In Gin handlers, use `c.Request.Context()` (not `context.Background()`) for database and outbound calls.

### 3.3 Always call the cancel function

```go
// ❌ Wrong: cancel is never called
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
// missing cancel(); may leak resources

// ✅ Right: defer guarantees the call
ctx, cancel := context.WithTimeout(parentCtx, 5*time.Second)
defer cancel() // call it even if the timeout fires
```

### 3.4 Respond to cancellation

```go
// ✅ Recommended: check the context during long operations
func LongRunningTask(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err() // context.Canceled or context.DeadlineExceeded
        default:
            // do a small chunk of work
            if err := doChunk(); err != nil {
                return err
            }
        }
    }
}
```

### 3.5 Distinguish why it was cancelled

```go
// ✅ Use ctx.Err() to tell the reasons apart
if err := ctx.Err(); err != nil {
    switch {
    case errors.Is(err, context.Canceled):
        log.Println("operation was canceled")
    case errors.Is(err, context.DeadlineExceeded):
        log.Println("operation timed out")
    }
    return err
}
```

---

## 4. Interface design

### 4.1 Accept interfaces, return structs

```go
// ❌ Not recommended: accept a concrete type
func SaveUser(db *sql.DB, user User) error

// ✅ Recommended: accept an interface (decoupled, easy to test)
type UserStore interface {
    Save(ctx context.Context, user User) error
}

func SaveUser(store UserStore, user User) error

// ❌ Not recommended: return an interface
func NewUserService() UserServiceInterface

// ✅ Recommended: return a concrete type
func NewUserService(store UserStore) *UserService
```

### 4.2 Define interfaces where they are consumed

```go
// ❌ Not recommended: interface defined in the implementing package
// package database
type Database interface {
    Query(ctx context.Context, query string) ([]Row, error)
    // ... 20 methods
}

// ✅ Recommended: the smallest interface the consumer needs, in the consumer's package
// package userservice
type UserQuerier interface {
    QueryUsers(ctx context.Context, filter Filter) ([]User, error)
}
```

### 4.3 Keep interfaces small and focused

```go
// ❌ Not recommended: one large catch-all interface
type Repository interface {
    GetUser(id int) (*User, error)
    CreateUser(u *User) error
    UpdateUser(u *User) error
    DeleteUser(id int) error
    GetOrder(id int) (*Order, error)
    CreateOrder(o *Order) error
    // ... more methods
}

// ✅ Recommended: small, focused interfaces
type UserReader interface {
    GetUser(ctx context.Context, id int) (*User, error)
}

type UserWriter interface {
    CreateUser(ctx context.Context, u *User) error
    UpdateUser(ctx context.Context, u *User) error
}

// compose them
type UserRepository interface {
    UserReader
    UserWriter
}
```

### 4.4 Do not overuse the empty interface

```go
// ❌ Not recommended: interface{} everywhere
func Process(data interface{}) interface{}

// ✅ Recommended: generics (Go 1.18+)
func Process[T any](data T) T

// ✅ Recommended: a concrete interface
type Processor interface {
    Process() Result
}
```

---

## 5. Choosing the receiver type

### 5.1 When to use a pointer receiver

```go
// ✅ When the method modifies the receiver
func (u *User) SetName(name string) {
    u.Name = name
}

// ✅ When the receiver contains sync.Mutex or other sync primitives
type SafeCounter struct {
    mu    sync.Mutex
    count int
}

func (c *SafeCounter) Inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.count++
}

// ✅ When the receiver is a large struct (avoids copying)
type LargeStruct struct {
    Data [1024]byte
    // ...
}

func (l *LargeStruct) Process() { /* ... */ }
```

### 5.2 When to use a value receiver

```go
// ✅ Small immutable structs
type Point struct {
    X, Y float64
}

func (p Point) Distance(other Point) float64 {
    return math.Sqrt(math.Pow(p.X-other.X, 2) + math.Pow(p.Y-other.Y, 2))
}

// ✅ Named basic types
type Counter int

func (c Counter) String() string {
    return fmt.Sprintf("%d", c)
}

// ✅ Maps, funcs and chans (already reference types)
type StringSet map[string]struct{}

func (s StringSet) Contains(key string) bool {
    _, ok := s[key]
    return ok
}
```

### 5.3 Be consistent

```go
// ❌ Not recommended: mixed receiver types
func (u User) GetName() string   // value receiver
func (u *User) SetName(n string) // pointer receiver

// ✅ Recommended: if any method needs a pointer receiver, use pointers for all
func (u *User) GetName() string { return u.Name }
func (u *User) SetName(n string) { u.Name = n }
```

---

## 6. Performance

Flag these only on hot paths or realistic data sizes, not as blanket style requests.

### 6.1 Preallocate slices

```go
// ❌ Not recommended: grow dynamically
var result []int
for i := 0; i < 10000; i++ {
    result = append(result, i) // repeated allocation and copying
}

// ✅ Recommended: preallocate when the size is known
result := make([]int, 0, 10000)
for i := 0; i < 10000; i++ {
    result = append(result, i)
}

// ✅ Or initialise directly
result := make([]int, 10000)
for i := 0; i < 10000; i++ {
    result[i] = i
}
```

### 6.2 Avoid unnecessary heap allocations

```go
// ❌ May escape to the heap
func NewUser() *User {
    return &User{} // escapes to the heap
}

// ✅ Consider returning a value (where appropriate)
func NewUser() User {
    return User{} // may be stack-allocated
}

// Check the escape analysis:
// go build -gcflags '-m -m' ./...
```

### 6.3 Reuse objects with sync.Pool

```go
// ✅ Recommended: sync.Pool for objects created and discarded at high frequency
var bufferPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func ProcessData(data []byte) string {
    buf := bufferPool.Get().(*bytes.Buffer)
    defer func() {
        buf.Reset()
        bufferPool.Put(buf)
    }()

    buf.Write(data)
    return buf.String()
}
```

### 6.4 String concatenation

```go
// ❌ Not recommended: + in a loop
var result string
for _, s := range strings {
    result += s // a new string each time
}

// ✅ Recommended: strings.Builder
var builder strings.Builder
for _, s := range strings {
    builder.WriteString(s)
}
result := builder.String()

// ✅ Or strings.Join
result := strings.Join(strings, "")
```

### 6.5 Avoid interface{} conversion cost

```go
// ❌ interface{} on a hot path
func process(data interface{}) {
    switch v := data.(type) { // type assertions have a cost
    case int:
        // ...
    }
}

// ✅ Generics or concrete types on hot paths
func process[T int | int64 | float64](data T) {
    // type known at compile time; no runtime cost
}
```

---

## 7. Testing

### 7.1 Table-driven tests

```go
// ✅ Recommended: table-driven tests
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 1, 2, 3},
        {"with zero", 0, 5, 5},
        {"negative numbers", -1, -2, -3},
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := Add(tt.a, tt.b)
            if result != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d",
                    tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

### 7.2 Parallel tests

```go
// ✅ Recommended: run independent cases in parallel
func TestParallel(t *testing.T) {
    tests := []struct {
        name  string
        input string
    }{
        {"test1", "input1"},
        {"test2", "input2"},
    }

    for _, tt := range tests {
        tt := tt // needed for Go < 1.22
        t.Run(tt.name, func(t *testing.T) {
            t.Parallel() // mark as parallelisable
            result := Process(tt.input)
            // assertions...
        })
    }
}
```

### 7.3 Mock through interfaces

```go
// ✅ Define an interface so it can be tested
type EmailSender interface {
    Send(to, subject, body string) error
}

// production implementation
type SMTPSender struct { /* ... */ }

// test mock
type MockEmailSender struct {
    SendFunc func(to, subject, body string) error
}

func (m *MockEmailSender) Send(to, subject, body string) error {
    return m.SendFunc(to, subject, body)
}

func TestUserRegistration(t *testing.T) {
    mock := &MockEmailSender{
        SendFunc: func(to, subject, body string) error {
            if to != "test@example.com" {
                t.Errorf("unexpected recipient: %s", to)
            }
            return nil
        },
    }

    service := NewUserService(mock)
    // test...
}
```

### 7.4 Test helpers

```go
// ✅ Mark helpers with t.Helper()
func assertEqual(t *testing.T, got, want interface{}) {
    t.Helper() // failures report the caller's line
    if got != want {
        t.Errorf("got %v, want %v", got, want)
    }
}

// ✅ Clean up with t.Cleanup()
func TestWithTempFile(t *testing.T) {
    f, err := os.CreateTemp("", "test")
    if err != nil {
        t.Fatal(err)
    }
    t.Cleanup(func() {
        os.Remove(f.Name())
    })
    // test...
}
```

---

## 8. Common pitfalls

### 8.1 Nil slice vs empty slice

```go
var nilSlice []int     // nil, len=0, cap=0
emptySlice := []int{}  // not nil, len=0, cap=0
made := make([]int, 0) // not nil, len=0, cap=0

// ✅ They encode differently in JSON
json.Marshal(nilSlice)   // null
json.Marshal(emptySlice) // []

// ✅ Recommended: initialise explicitly when the API must return []
if slice == nil {
    slice = []int{}
}
```

This matters for API contracts: a frontend that expects `[]` may crash on `null`.

### 8.2 Map initialisation

```go
// ❌ Wrong: uninitialised map
var m map[string]int
m["key"] = 1 // panic: assignment to entry in nil map

// ✅ Right: initialise with make
m := make(map[string]int)
m["key"] = 1

// ✅ Or with a literal
m := map[string]int{}
```

### 8.3 defer inside a loop

```go
// ❌ Potential problem: defer runs only when the function returns
func processFiles(files []string) error {
    for _, file := range files {
        f, err := os.Open(file)
        if err != nil {
            return err
        }
        defer f.Close() // every file stays open until the function ends!
        // process...
    }
    return nil
}

// ✅ Right: use a closure or extract a function
func processFiles(files []string) error {
    for _, file := range files {
        if err := processFile(file); err != nil {
            return err
        }
    }
    return nil
}

func processFile(file string) error {
    f, err := os.Open(file)
    if err != nil {
        return err
    }
    defer f.Close()
    // process...
    return nil
}
```

### 8.4 Slices share their backing array

```go
// ❌ Potential problem: a sub-slice shares the backing array
original := []int{1, 2, 3, 4, 5}
slice := original[1:3] // [2, 3]
slice[0] = 100         // modifies original!
// original is now [1, 100, 3, 4, 5]

// ✅ Right: copy explicitly when you need an independent slice
slice := make([]int, 2)
copy(slice, original[1:3])
slice[0] = 100 // original is unchanged
```

### 8.5 Substring memory retention

```go
// ❌ Potential problem: a substring keeps the whole backing array alive
func getPrefix(s string) string {
    return s[:10] // still references all of s
}

// ✅ Right: make an independent copy (Go 1.18+)
func getPrefix(s string) string {
    return strings.Clone(s[:10])
}

// ✅ Before Go 1.18
func getPrefix(s string) string {
    return string([]byte(s[:10]))
}
```

### 8.6 The nil-interface trap

```go
// ❌ Trap: nil checks on an interface
type MyError struct{}
func (e *MyError) Error() string { return "error" }

func returnsError() error {
    var e *MyError = nil
    return e // the returned error is NOT nil!
}

func main() {
    err := returnsError()
    if err != nil { // true! interface{type: *MyError, value: nil}
        fmt.Println("error:", err)
    }
}

// ✅ Right: return nil explicitly
func returnsError() error {
    var e *MyError = nil
    if e == nil {
        return nil // explicit nil
    }
    return e
}
```

### 8.7 Comparing times

```go
// ❌ Not recommended: == on time.Time
if t1 == t2 { // can fail because of monotonic-clock readings
    // ...
}

// ✅ Recommended: the Equal method
if t1.Equal(t2) {
    // ...
}

// ✅ Comparing order
if t1.Before(t2) || t1.After(t2) {
    // ...
}
```

---

## 9. Code organisation

### 9.1 Package names

```go
// ❌ Not recommended
package common   // too broad
package utils    // too broad
package helpers  // too broad
package models   // grouped by kind

// ✅ Recommended: name by what it does
package user     // user functionality
package order    // order functionality
package postgres // PostgreSQL implementation
```

Follow the existing layout of the repository under review; do not ask for package renames in an unrelated PR.

### 9.2 Avoid import cycles

```go
// ❌ Import cycle
// package a imports package b
// package b imports package a

// ✅ Fix 1: move shared types into their own package
// package types (shared types)
// package a imports types
// package b imports types

// ✅ Fix 2: decouple with an interface
// package a defines the interface
// package b implements it
```

### 9.3 Exported identifiers

```go
// ✅ Export only what is needed
type UserService struct {
    db *sql.DB // unexported
}

func (s *UserService) GetUser(id int) (*User, error) // exported
func (s *UserService) validate(u *User) error         // unexported

// ✅ internal packages restrict access
// internal/database/... can only be imported from within the same module
```

---

## 10. Tools and checks

### 10.1 Required tools

```bash
# formatting (required)
gofmt -w .
goimports -w .

# static analysis
go vet ./...

# race detection
go test -race ./...

# escape analysis
go build -gcflags '-m -m' ./...
```

### 10.2 Recommended linters

```bash
# golangci-lint (bundles many linters)
golangci-lint run

# commonly enabled checks
# - errcheck: unchecked errors
# - gosec: security checks
# - ineffassign: ineffective assignments
# - staticcheck: static analysis
# - unused: unused code
```

Formatting and lint findings belong to CI, not to review comments (see `../AGENTS.md`).

### 10.3 Benchmarks

```go
// ✅ Benchmark tests
func BenchmarkProcess(b *testing.B) {
    data := prepareData()
    b.ResetTimer() // reset the timer

    for i := 0; i < b.N; i++ {
        Process(data)
    }
}

// run the benchmarks
// go test -bench=. -benchmem ./...
```

---

## References

- [Effective Go](https://go.dev/doc/effective_go)
- [Go Code Review Comments](https://go.dev/wiki/CodeReviewComments)
- [Go Common Mistakes](https://go.dev/wiki/CommonMistakes)
- [100 Go Mistakes](https://100go.co/)
- [Go Proverbs](https://go-proverbs.github.io/)
- [Uber Go Style Guide](https://github.com/uber-go/guide/blob/master/style.md)
