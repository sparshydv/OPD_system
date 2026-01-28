# OPD Token Allocation System - Architecture

A comprehensive design document describing the layered architecture, data flow, and core principles of the OPD token allocation engine.

---

## Table of Contents

1. [Architectural Overview](#architectural-overview)
2. [Allocation Engine Isolation](#allocation-engine-isolation)
3. [Data Flow](#data-flow)
4. [Time Handling Model](#time-handling-model)
5. [Design Principles](#design-principles)
6. [Extensibility](#extensibility)

---

## Architectural Overview

### Layered Architecture

The system is organized into four distinct layers, each with clear responsibilities and separation of concerns:

```
┌────────────────────────────────────────────┐
│         Presentation Layer                 │
│      (REST API Controllers)                │
│   • HTTP Request/Response Handling         │
│   • Route Mapping                          │
│   • Authentication/Authorization           │
└────────────────────┬─────────────────────┘
                     │
┌────────────────────▼─────────────────────┐
│         Application Layer                 │
│      (Token Service)                      │
│   • Business Logic Orchestration          │
│   • Request Validation                    │
│   • State Transitions                     │
│   • Event Coordination                    │
└────────────────────┬─────────────────────┘
                     │
┌────────────────────▼─────────────────────┐
│         Domain Layer                      │
│      (Allocation Engine)                  │
│   • Priority Scoring                      │
│   • Capacity Checks                       │
│   • Allocation Algorithms                 │
│   • Rebalancing Logic                     │
│   • Queue Management                      │
└────────────────────┬─────────────────────┘
                     │
┌────────────────────▼─────────────────────┐
│         Data Layer                        │
│      (In-Memory Storage)                  │
│   • Token Repository                      │
│   • Slot Repository                       │
│   • Doctor Registry                       │
│   • Patient Registry                      │
│   • Queue Repository                      │
└────────────────────────────────────────────┘
```

### Layer Responsibilities

#### Presentation Layer (Controllers)
- **Scope**: HTTP endpoint handling
- **Concerns**: 
  - Request parsing and validation
  - Response formatting
  - Error handling and HTTP status codes
  - Request routing
- **Does NOT know**: Allocation algorithms, slot logic, or rebalancing

#### Application Layer (Service)
- **Scope**: Business logic coordination
- **Concerns**:
  - Orchestrating domain operations
  - Enforcing business rules
  - Managing state transitions
  - Coordinating events (cancellations, no-shows)
- **Does NOT know**: HTTP specifics or storage implementation details

#### Domain Layer (Allocation Engine)
- **Scope**: Core allocation logic
- **Concerns**:
  - Deterministic allocation decisions
  - Priority-based slot selection
  - Capacity validation
  - Cascading reallocation
  - Waiting queue management
- **Does NOT know**: HTTP, REST, databases, or external systems

#### Data Layer (Storage)
- **Scope**: State persistence
- **Concerns**:
  - Reading/writing entity state
  - Query support
  - Consistency guarantees
- **Does NOT know**: Allocation logic or business rules

### Dependency Direction

```
Controllers  →  Service  →  Engine  ←→  Storage
                                ↑
                          (No dependencies)
```

**Key Principle**: Each layer depends on layers below it, but NOT on layers above. The Allocation Engine has no knowledge of HTTP, REST, or even the application using it.

---

## Allocation Engine Isolation

### Why Framework-Agnostic?

The Allocation Engine is deliberately isolated from any framework or external system:

#### 1. **Testability**
The engine can be tested independently without:
- Web framework setup
- HTTP mocking
- Database connections
- External service dependencies

**Benefit**: Unit tests run fast, deterministically, and in any environment.

#### 2. **Determinism**
The engine produces identical results for identical inputs:
- No dependency on system clock (uses simulation time)
- No random number generation (uses deterministic seeding)
- No external API calls (all data is provided as input)

**Benefit**: Results are reproducible and auditable.

#### 3. **Portability**
The same engine can be used in:
- REST API servers
- Batch processing systems
- Event-driven systems
- Desktop applications
- Mobile backends

**Benefit**: Core logic is never rewritten or adapted per platform.

#### 4. **Verification**
Allocation decisions are verifiable:
- Input data is explicit (no hidden state)
- Output includes decision reasoning
- Priority scoring is transparent
- Constraints are checked explicitly

**Benefit**: Compliance audits can verify every decision.

### Engine Interface Pattern

The Allocation Engine operates on **pure functions**:

```
Input: Token + Slots + Current Time + Existing Allocations
↓
[Core Algorithm - No Side Effects]
↓
Output: Allocation Result + Metadata
```

**Pure Function Characteristics**:
- Same input always produces same output
- No modifications to input parameters
- No access to global state
- All dependencies passed as arguments
- Results are immutable

### Decoupling Strategy

The engine uses **explicit dependencies**:

Instead of:
```
Engine queries the database for slots
```

The design uses:
```
Caller provides slots array to engine
```

**Benefits**:
- Engine never makes remote calls
- Tests can provide mock data
- No network latency in allocation
- Easy to parallelize
- Easy to cache results

---

## Data Flow

### Token Creation Flow

```
1. HTTP Request arrives at Controller
   │
   └─> Extract and validate input (JSON schema validation)
       │
       ├─> Missing fields? → HTTP 400 (Bad Request)
       ├─> Invalid doctor? → HTTP 404 (Not Found)
       ├─> Invalid slot? → HTTP 404 (Not Found)
       └─> Valid? Continue...
           │
2. Service receives validated request
   │
   └─> Check business rules (patient exists, booking policy, etc.)
       │
       ├─> Business rule violated? → HTTP 422 (Unprocessable Entity)
       └─> Rules satisfied? Continue...
           │
3. Allocation Engine processes allocation
   │
   ├─> Calculate priority score for token
   │
   ├─> Check slot capacity
   │   │
   │   ├─> Slot has space? → ALLOCATED (slot capacity++)
   │   │
   │   ├─> Slot is full? Try cascading reallocation
   │   │   │
   │   │   ├─> Found space elsewhere? → REALLOCATED (token moved)
   │   │   │
   │   │   └─> No space found? → ADDED_TO_WAITING_QUEUE (queue++)
   │   │
   │   └─> Eviction case (emergency)? → EMERGENCY_ALLOCATED (evicts lower-priority token)
   │
4. Storage layer updates state
   │
   └─> Token repository: Add new token
       Slot repository: Update token count
       Queue repository: Add to queue if needed
       │
5. Service returns result
   │
   └─> HTTP Response (200 with allocation details)
```

### Event-Driven Rebalancing

When events occur (cancellations, no-shows), the system triggers cascading rebalancing:

```
Token Cancelled
    │
    └─> Service.cancelToken()
        │
        └─> Allocation Engine.rebalanceAfterCancellation()
            │
            ├─> Free space in slot (capacity--)
            │
            ├─> Check waiting queue for same slot
            │   │
            │   ├─> Highest-priority queued token → PROMOTED to slot
            │   │   (slot capacity++, queue size--)
            │   │
            │   └─> No queued tokens? Stop.
            │
            ├─> Check if reallocations needed
            │   │
            │   └─> For each slot at capacity with low-priority tokens
            │       │
            │       ├─> Can reallocate to freed space? → REALLOCATED
            │       │
            │       └─> Already optimal? → No change
            │
            └─> Return rebalancing result with affected tokens
```

### Allocation Result States

Every allocation attempt produces one of these states:

| State | Meaning | Next Action |
|-------|---------|------------|
| `ALLOCATED` | Token placed directly in slot | None (success) |
| `REALLOCATED` | Token moved from lower-priority slot | None (success) |
| `EMERGENCY_ALLOCATED` | Emergency token evicted a lower-priority token | Lower-priority token goes to queue |
| `ADDED_TO_WAITING_QUEUE` | No space available; token queued | Wait for slot to free up |
| `PROMOTION_FROM_QUEUE` | Queued token promoted to slot | None (rebalancing complete) |
| `FAILED_ALLOCATION` | Validation failed before engine | Error response to caller |

---

## Time Handling Model

### Two Time Concepts

The system maintains two distinct time concepts:

#### 1. **Wall Clock Time** (Real Calendar Time)
- Current actual time from system clock
- Used for: Logging, monitoring, user-facing timestamps
- Example: `2026-01-28T17:22:15.883Z`

#### 2. **Simulation Time** (Logical Time)
- Artificial time controlled by the simulation
- Used for: Allocation decisions, validation, constraints
- Example: `2026-01-28T08:30:00.000Z` (30 min before earliest slot)

### Why Simulation Time?

#### Determinism Requirement
If allocations used wall clock time:
- Running same scenario at different real times → Different results
- Morning runs behave differently than evening runs
- Tests cannot be reproducible
- Historical data cannot be replayed

Solution: Use fixed simulation time for all time-sensitive decisions.

#### Validation Example

```
Slot opens at: 09:00 AM (wall time)
Simulation time: 08:30 AM (30 min before)
Current wall time: 04:00 PM (4 hours later, mid-simulation)

Token validation:
  Is token.createdAt > simulation.startTime?
  Is slot.startTime > simulation.currentTime?
  
Using SIMULATION time (08:30 AM):
  ✓ Token created at 08:30 AM is valid
  ✓ Slot at 09:00 AM is still "future"
  
Using WALL CLOCK time (04:00 PM):
  ✗ Token created at 08:30 AM is invalid (expired)
  ✗ Slot at 09:00 AM is in the past (already happened)
```

### Time Handling Strategy

```
┌─────────────────────────────────────────┐
│     Simulation Configuration            │
│                                         │
│  • Simulation Start Time: 08:30 AM      │
│  • Simulation Current Time: 08:30 AM   │
│  • (Updated in Event Loop)              │
│                                         │
│  Wall Clock Time: 04:00 PM              │
│  (For logging only)                     │
└──────────┬──────────────────────────────┘
           │
           ├─► Validation Module
           │   └─> Uses Simulation Time
           │       (Is token valid for this slot?)
           │
           ├─► Allocation Engine
           │   └─> Uses Simulation Time
           │       (Score-based, time-independent)
           │
           ├─► Event Timeline
           │   └─> Uses Simulation Time
           │       (When did events occur?)
           │
           └─► Logging Output
               └─> Uses Wall Clock Time
                   (When was this logged?)
```

### Benefits of This Model

1. **Reproducibility**: Same scenario always behaves identically
2. **Testability**: No flaky tests due to timing differences
3. **Auditability**: Historical scenarios can be replayed exactly
4. **Simplicity**: No complex time zone handling
5. **Performance**: Removes system clock dependencies

### Simulation Time Advancement

In a real-time system:
```
As wall clock advances → Simulation events trigger → Time advances naturally
```

In batch/simulation mode:
```
Events are processed in sequence → Simulation time advances to each event
```

---

## Design Principles

### 1. **Separation of Concerns**
Each layer has single responsibility:
- Controller: HTTP details only
- Service: Business orchestration only
- Engine: Algorithms only
- Storage: Data persistence only

### 2. **Determinism**
- No randomness in allocation logic
- Fixed seed for any randomization
- Reproducible results for identical inputs
- All time-dependent logic uses simulation time

### 3. **Immutability**
- Input data is never modified during processing
- Results are computed fresh each time
- State changes are tracked via new objects

### 4. **Explicit Dependencies**
- No hidden global state
- All required data passed as parameters
- No implicit assumptions about caller context

### 5. **Verifiability**
- Every allocation decision is logged
- Decision reasoning is included in output
- Priority scoring is transparent
- Constraints are explicitly checked

### 6. **Scalability**
- Stateless allocation engine (can run in parallel)
- No synchronous external calls
- Batch processing support
- Event-driven architecture

---

## Extensibility

### Adding New Token Sources

To support a new patient type (e.g., VIP patients):

1. **Define Priority**: Assign priority score (higher = higher priority)
2. **Validation**: Add business rules (e.g., VIP must have referral)
3. **Integration**: Service layer coordinates with new source
4. **Engine**: No changes needed (engine is source-agnostic)

### Adding New Rebalancing Strategies

Current strategy: Promote queued tokens on cancellation

Alternative strategy: Shift lower-priority tokens between slots

1. **Define Strategy**: Create new rebalancing algorithm
2. **Integration**: Service layer selects strategy based on context
3. **Engine**: No changes needed (engine accepts strategy as parameter)

### Supporting Different Slot Types

Current: Fixed capacity slots (30 patients per slot)

Alternative: Variable capacity (doctor experience, patient complexity)

1. **Slot Configuration**: Specify capacity per slot
2. **Validation**: Engine checks against specified capacity
3. **Engine**: No changes needed (capacity passed as input)

### Event-Driven System Integration

Current: Synchronous REST API

Alternative: Async event processing

```
REST API        →  Service  →  Event Queue  →  Allocation Worker  →  Result Repository
(Request-driven)                             (Event-driven)
```

1. **Event Schema**: Define token allocation events
2. **Service Layer**: Emit events instead of synchronous responses
3. **Worker**: Processes events asynchronously
4. **Engine**: No changes needed (same logic applies)

---

## Architecture Decision Records (ADR)

### ADR-001: Pure Functions for Allocation Engine
**Decision**: Allocation engine uses pure functions (no side effects)

**Rationale**:
- Enables deterministic testing
- Allows parallel execution
- Simplifies verification and auditing
- Reduces complexity

---

### ADR-002: Simulation Time vs Wall Clock
**Decision**: Time-dependent decisions use simulation time, not wall clock

**Rationale**:
- Reproducible results across runs
- Supports historical scenario replay
- Eliminates timezone complexity
- Enables batch processing

---

### ADR-003: Framework-Agnostic Allocation Engine
**Decision**: Core allocation logic independent of any web framework

**Rationale**:
- Reusable across different platforms
- Easier to test in isolation
- Portable to different contexts
- Future-proof against framework changes

---

## References

- **Design Patterns Used**: Service Locator, Strategy Pattern, Observer Pattern
- **Related Concepts**: Event Sourcing, Domain-Driven Design, Clean Architecture
- **Similar Systems**: Hospital Information Systems (HIS), Appointment Scheduling Engines

---

**Document Version**: 1.0  
**Last Updated**: January 28, 2026  
**Audience**: Architects, Senior Developers, Evaluators
