# Token Allocation and Reallocation Logic

A comprehensive guide to the priority-based token allocation system, reallocation strategies, and emergency handling mechanisms.

---

## Table of Contents

1. [Token Types and Priority Order](#token-types-and-priority-order)
2. [Allocation Rules](#allocation-rules)
3. [Reallocation Logic](#reallocation-logic)
4. [Emergency Handling](#emergency-handling)
5. [Capacity Management](#capacity-management)
6. [Examples and Scenarios](#examples-and-scenarios)

---

## Token Types and Priority Order

### Priority Hierarchy

Tokens are classified by patient source and assigned priority scores. Higher scores indicate higher priority in allocation decisions.

```
┌─────────────────────────────────────────────┐
│ EMERGENCY (Highest Priority)                │
│ Score: 100                                  │
│ Override: Can evict lower-priority tokens   │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ FOLLOW_UP (High Priority)                   │
│ Score: 50                                   │
│ Treatment: Returning patient, existing case │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ PAID (Medium Priority)                      │
│ Score: 40                                   │
│ Treatment: Private/paid consultation        │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ ONLINE (Medium Priority)                    │
│ Score: 40                                   │
│ Treatment: Pre-booked online                │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ WALKIN (Lowest Priority)                    │
│ Score: 25                                   │
│ Treatment: Walk-in on the day               │
└─────────────────────────────────────────────┘
```

### Priority Score Definition

Each token type has a **base priority score**:

| Type | Score | Rationale |
|------|-------|-----------|
| **EMERGENCY** | 100 | Critical cases requiring immediate attention; safety override |
| **FOLLOW_UP** | 50 | Continuity of care; existing patient management |
| **PAID** | 40 | Revenue and service commitment |
| **ONLINE** | 40 | Pre-planned appointment |
| **WALKIN** | 25 | Unplanned; lowest certainty of commitment |

### Tie-Breaking

When multiple tokens have the same priority score (e.g., two PAID tokens), the system uses **token creation time** as tie-breaker:

- Earlier created token (older) → Higher priority
- This ensures FIFO behavior within same priority level
- Deterministic: no randomness, reproducible ordering

---

## Allocation Rules

### Fundamental Constraints

#### 1. **Slot Capacity is a Hard Limit**

Every slot has a fixed maximum capacity:
- Example: Doctor A has 4 morning slots, each capacity 30 patients
- Capacity is **absolute** and **non-negotiable**
- Cannot be exceeded under any circumstances

#### 2. **One Token = One Capacity Unit**

Token allocation math:
```
Token created → 1 capacity unit consumed
Token cancelled → 1 capacity unit freed
Token no-show → 1 capacity unit freed (treated same as cancellation)
```

**Important**: No fractional allocation. Each token takes exactly one unit.

#### 3. **No Over-Allocation**

```
Slot Capacity: 30
Current Occupancy: 29
Waiting Queue: 15

Attempting Allocation:
  Available space? YES (29 < 30)
  → ALLOCATE immediately

Attempting Allocation (Slot Full):
  Available space? NO (30 = 30)
  → Cannot allocate to this slot
  → Try cascade reallocation
  → If no space elsewhere → Add to waiting queue
```

### Allocation Decision Tree

```
                    Token Request Arrives
                            │
                            ▼
                  Check Slot Capacity
                            │
                ┌───────────┴───────────┐
                │                       │
           Slot Has Space          Slot is Full
                │                       │
                ▼                       ▼
          ALLOCATE              Cascading Reallocation
          (Direct)              (Try to find alternative slot)
                                        │
                            ┌───────────┴───────────┐
                            │                       │
                    Space Found          No Space Available
                            │                       │
                            ▼                       ▼
                    REALLOCATE             WAITING_QUEUE
                    (Move lower-pri)      (Queue for promotion)
```

### Slot Capacity Enforcement

```
Doctor A - Morning Slot 1:
├─ Capacity: 30 patients (fixed)
├─ Current Occupancy: 27
│   ├─ Token-001 (PAID)
│   ├─ Token-002 (ONLINE)
│   ├─ ... (25 more tokens)
├─ Available Space: 3 units
│   ├─ For PAID: 3 units available
│   ├─ For WALKIN: 3 units available
│   └─ For EMERGENCY: 3 units available (can evict if needed)
└─ Status: Can accept 3 more tokens

Slot Status Matrix:
┌──────────────────────┐
│ ███████████████ FULL │  Occupancy: 27/30 (90%)
│ ███ AVAILABLE        │  Available: 3/30 (10%)
└──────────────────────┘
```

---

## Reallocation Logic

### What is Reallocation?

Reallocation is the process of moving a token from one slot to another when:
1. Original slot becomes full or unbalanced
2. A higher-priority token needs space
3. A cancellation creates an opportunity for better distribution

Reallocation is **transparent** to the patient—they still get a slot, possibly different from original.

### Trigger Events

Reallocation is triggered by three events:

#### 1. **Cancellation Event**

When a patient cancels:
```
Token-ABC (PAID) in Slot-1 is cancelled
  ↓
Slot-1 capacity freed (occupancy -1)
  ↓
System checks: Are there queued tokens for Slot-1?
  ├─ YES → PROMOTE highest-priority queued token to Slot-1
  ├─ NO → Check if rebalancing is needed
  │        (Can lower-priority tokens move away to create
  │         better distribution?)
  └─ COMPLETE
```

#### 2. **No-Show Event**

When a patient doesn't arrive:
```
Token-XYZ (FOLLOW_UP) in Slot-2 is marked as no-show
  ↓
Treat same as cancellation
  ↓
Slot-2 capacity freed (occupancy -1)
  ↓
Promote queued tokens or rebalance
```

#### 3. **High-Priority Token Arrival**

When a FOLLOW_UP or PAID token cannot find direct capacity:
```
New FOLLOW_UP token arrives
  ↓
Primary slot is full
  ↓
Search for alternative slots with space
  ├─ Space found? → REALLOCATE to alternative slot
  ├─ No space? → Check for lower-priority tokens to evict
  │               (WALKIN or ONLINE can be downgraded to queue)
  └─ Reorganized distribution
```

### Cascading Reallocation Process

"Cascading" means the system may move multiple tokens to optimize distribution.

#### Example: Cascading Scenario

```
Initial State:
┌─────────────────────────────────────────────┐
│ Slot-1 (Doctor A): FULL (30/30)             │
│ ├─ 25 PAID tokens                           │
│ ├─ 3 ONLINE tokens                          │
│ ├─ 2 WALKIN tokens                          │
│                                              │
│ Slot-2 (Doctor B): NOT FULL (20/30)         │
│ ├─ 15 FOLLOW_UP tokens                      │
│ ├─ 5 ONLINE tokens                          │
│                                              │
│ Waiting Queue: [FOLLOW_UP-001, ONLINE-002]  │
└─────────────────────────────────────────────┘

Event: New FOLLOW_UP token arrives
├─ Cannot allocate to Slot-1 (full)
├─ Slot-2 has space? YES (20 < 30)
├─ Direct allocation to Slot-2? YES
└─ Result: Token allocated, no cascading needed

Event: New FOLLOW_UP token arrives (second one)
├─ Cannot allocate to Slot-1 (full)
├─ Cannot allocate to Slot-2 (now 21/30)
│  Wait... let's check if we can rearrange
├─ Cascading check: Can we move WALKIN from Slot-1 to
│  create space for FOLLOW_UP?
│  ├─ WALKIN has priority 25
│  ├─ FOLLOW_UP has priority 50
│  ├─ Moving WALKIN to queue allows FOLLOW_UP in Slot
│  └─ YES, execute cascade
└─ Result:
    ├─ WALKIN token moved to Slot-1 queue
    ├─ FOLLOW_UP token allocated to Slot-1 freed space
    └─ System rebalanced
```

### Reallocation Safety Guarantees

1. **No Patient Loss**: Every token always has a destination
   - Allocated directly OR
   - Allocated to alternative slot OR
   - Placed in waiting queue (guaranteed promotion on space)

2. **Priority Preserved**: Higher-priority tokens are never downgraded
   - FOLLOW_UP token is never displaced by PAID token
   - PAID token is never displaced by ONLINE token
   - Only exception: EMERGENCY always displaces anyone

3. **Deterministic Ordering**: Same conditions always produce same moves
   - Token creation time is sole tie-breaker
   - No randomness, no timing dependencies
   - Reproducible across runs

4. **Fairness in Queue**: Queued tokens promoted in priority order
   - Highest priority token in queue promotes first
   - Same priority uses FIFO (creation time)
   - Prevents starvation

### Reallocation Example Detailed Walkthrough

```
Starting Configuration:

Doctor A (Slot-A):
├─ Capacity: 30
├─ Current: 30 (FULL)
│  ├─ 2 FOLLOW_UP (priority 50)
│  ├─ 10 PAID (priority 40)
│  ├─ 10 ONLINE (priority 40)
│  ├─ 8 WALKIN (priority 25)
├─ Queue: [ONLINE-Q1, WALKIN-Q1]

Doctor B (Slot-B):
├─ Capacity: 30
├─ Current: 20 (NOT FULL)
│  ├─ 15 FOLLOW_UP (priority 50)
│  ├─ 5 ONLINE (priority 40)
├─ Queue: []

Event: FOLLOW_UP Token-New arrives (priority 50)

Step 1: Try Primary Slot (Slot-A)
  Question: Does Slot-A have capacity?
  Answer: NO (30/30 full)
  Action: Continue to cascading logic

Step 2: Check for Cascading Opportunity
  Question: Are there lower-priority tokens in Slot-A?
  Answer: YES - 8 WALKIN tokens (priority 25)
  
  Decision: Move 1 WALKIN to queue (priority 25)
            Give Slot-A space to FOLLOW_UP (priority 50)
  Rationale: FOLLOW_UP > WALKIN, improves distribution
  
  Action: Execute cascade

Step 3: Cascade Execution
  3a. Remove 1 WALKIN token from Slot-A
      └─ Slot-A occupancy: 30 → 29
      
  3b. Add 1 WALKIN token to Slot-A queue
      └─ Queue: [ONLINE-Q1, WALKIN-Q1, WALKIN-NEW]
      
  3c. Add FOLLOW_UP-New token to Slot-A
      └─ Slot-A occupancy: 29 → 30
      
  3d. Log reallocation event
      └─ "WALKIN cascade: removed to queue, FOLLOW_UP allocated"

Step 4: Check for Secondary Cascading
  Question: Did this create opportunities in other slots?
  Analysis:
    └─ Slot-B: Still has 10 capacity (20/30), no change needed
  
  Action: Stop, distribution is optimal

Final Configuration:

Doctor A (Slot-A):
├─ Capacity: 30
├─ Current: 30 (FULL)
│  ├─ 3 FOLLOW_UP (priority 50) ← +1 new
│  ├─ 10 PAID (priority 40)
│  ├─ 10 ONLINE (priority 40)
│  ├─ 7 WALKIN (priority 25) ← -1 cascaded
├─ Queue: [ONLINE-Q1, WALKIN-Q1, WALKIN-New]

Doctor B (Slot-B):
├─ Capacity: 30
├─ Current: 20 (unchanged)
├─ Queue: []

Cascade Result: SUCCESS
└─ Token-New allocated to Slot-A
└─ WALKIN-Displaced queued for promotion
└─ Distribution improved (3 FOLLOW_UP vs 2 before)
```

---

## Emergency Handling

### What is an Emergency?

An emergency token represents a critical patient who:
- Needs immediate medical attention
- Cannot wait in queue
- May have arrived outside normal hours
- Takes priority over all other patient types

**Priority Score**: 100 (vs highest normal priority of 50)

### Emergency Priority Override

```
Emergency Patient Arrives
    │
    ├─ Is there available capacity in any slot?
    │  ├─ YES → Direct allocation to slot with capacity
    │  │        ALLOCATED (no disruption)
    │  │
    │  └─ NO → All slots full
    │
    ├─ Search for lowest-priority token to evict
    │  │
    │  ├─ Found WALKIN token? (priority 25)
    │  │  └─ EVICT WALKIN → Add to queue
    │  │     ALLOCATE EMERGENCY to freed space
    │  │
    │  ├─ Found ONLINE token? (priority 40)
    │  │  └─ EVICT ONLINE → Add to queue
    │  │     ALLOCATE EMERGENCY to freed space
    │  │
    │  └─ All tokens are FOLLOW_UP or PAID?
    │     └─ EVICT lowest-priority (creation time determines)
    │        ALLOCATE EMERGENCY to freed space
    │
    └─ Emergency allocation ALWAYS succeeds
```

### Why Emergencies Are Never Rejected

Emergency rejections would violate medical ethics and safety:

1. **Safety Guarantee**: System promises to never turn away critical patients
2. **Legal Requirement**: Most jurisdictions require emergency acceptance
3. **Medical Ethics**: Hippocratic oath includes emergency treatment
4. **Trust**: Patients must know they can always get emergency care

**Implementation**: Emergency tokens have priority 100, triggering:
- Direct allocation if any slot has space
- Eviction of lower-priority tokens if needed
- Guaranteed allocation or forced queue promotion

### Emergency Eviction Strategy

When an emergency token evicts another patient:

```
Eviction Happens When:
├─ No available capacity
├─ Emergency priority (100) > All other types (max 50)
└─ System must free a slot

Eviction Order (by priority):
1. WALKIN (25) ← Most likely to evict
2. ONLINE (40)
3. PAID (40) ← Same score, use creation time
4. FOLLOW_UP (50) ← Last resort
5. Another EMERGENCY (100) ← Only if multiple emergencies

Decision Basis:
├─ Primary: Priority score (ascending)
├─ Tie-breaker: Creation timestamp (descending - older first)
└─ Goal: Evict lowest-value token
```

### Emergency vs. Normal Allocation

| Aspect | Normal Token | Emergency Token |
|--------|--------------|-----------------|
| **Priority Score** | 25-50 | 100 |
| **Can Be Evicted?** | Yes (by EMERGENCY) | Only by another EMERGENCY |
| **Queue Acceptance** | Yes | No (never queued) |
| **Capacity Check** | Required | Overridden if needed |
| **Reallocation** | Only if beneficial | Always succeeds |
| **Rejection Possible** | Yes (queue) | Never |

### Emergency Safety Guarantees

1. **Allocation Guarantee**: EMERGENCY tokens always get allocated
   - No rejection, no queue, no exceptions
   - Worst case: Evict lower-priority token

2. **Deterministic Eviction**: Same eviction candidate always chosen
   - Priority score as primary criterion
   - Creation time as tie-breaker
   - No randomness, fully reproducible

3. **Minimal Disruption**: Evicted token goes to queue (not lost)
   - Evicted token can still be promoted later
   - No data loss, no patient abandonment
   - Fairness preserved

4. **Reversible**: Queue promotion restores balance
   - Queued token can be allocated to any slot
   - Not restricted to original slot
   - System self-corrects over time

---

## Capacity Management

### Capacity Lifecycle

```
                    Slot Created
                         │
                         ▼
        Total Capacity: 30 units (fixed)
                         │
           ┌─────────────┴─────────────┐
           │                           │
    Available Capacity          Occupied Capacity
    (Can accept tokens)         (Token holders)
           │                           │
      Change: Slot           Change: Token lifecycle
      is full/empty                   │
           │            ┌──────────────┼──────────────┐
           │            │              │              │
        Allocation   Cancellation   No-Show      Emergency
         (+token)      (-token)      (-token)     (eviction)
           │            │              │
           └────────────┴──────────────┘
                        │
                        ▼
            Capacity adjustments
            (decreases/increases)
```

### Slot Rebalancing Triggers

```
Event: Cancellation
└─ Slot capacity increases
   ├─ Promotes queued token? → Capacity stays same, queue shrinks
   ├─ No queue? → Slot becomes under-utilized
   │  └─ Check for reallocation of other patients
   └─ Result: Slot reaches new equilibrium

Event: New Token Allocation
└─ Slot capacity decreases
   ├─ Slot becomes full? → Reallocation may occur
   ├─ Still has space? → No action needed
   └─ Result: Slot reaches new equilibrium

Event: Emergency Eviction
└─ One token removed, emergency added
   ├─ Net capacity change: 0
   ├─ Removed token goes to queue
   └─ Result: Slot composition changes, queue grows
```

---

## Examples and Scenarios

### Scenario 1: Simple Allocation (Normal Case)

```
Context:
├─ Doctor A Slot 1: Capacity 30, Current occupancy 25
├─ New PAID token arrives

Process:
├─ Check Slot capacity: 25 < 30? YES
├─ Direct allocation: YES
├─ Result: ALLOCATED
│  └─ Occupancy: 25 → 26
│  └─ No cascading, no queue involvement
```

### Scenario 2: Queuing (Slot Full)

```
Context:
├─ Doctor A Slot 1: Capacity 30, Current occupancy 30 (FULL)
├─ New ONLINE token arrives
├─ No other slots have capacity

Process:
├─ Check primary slot capacity: 30 = 30? FULL
├─ Search for alternative slots: None with capacity
├─ Check for eviction candidates: None (same priority)
├─ Add to queue: YES
├─ Result: ADDED_TO_WAITING_QUEUE
│  └─ Queue: [ONLINE-New]
│  └─ Slot capacity unchanged (30/30)
│  └─ Token promoted when capacity opens
```

### Scenario 3: Cascading Reallocation (Complex Case)

```
Context:
├─ Slot-A: 30/30 (8 WALKIN, 22 higher-priority)
├─ Slot-B: 28/30 (mostly FOLLOW_UP)
├─ New FOLLOW_UP token arrives

Process:
Step 1: Try Slot-A (primary for FOLLOW_UP)
├─ Capacity? 30/30 = FULL

Step 2: Cascading check
├─ WALKIN tokens available to move? YES (8 present)
├─ Move 1 WALKIN to queue
├─ Allocate FOLLOW_UP to freed space
├─ Result: ALLOCATED + CASCADED
│  └─ Slot-A: 30/30 (1 less WALKIN, 1 more FOLLOW_UP)
│  └─ Queue: [WALKIN-Cascaded]
```

### Scenario 4: Emergency Eviction (Critical)

```
Context:
├─ All slots at capacity 30/30
├─ All slots contain mix of PAID, ONLINE, WALKIN
├─ Emergency token arrives

Process:
Step 1: Check availability
├─ Any slot with capacity? NO (all 30/30)

Step 2: Find eviction candidate
├─ Scan all slots for lowest-priority token
├─ Found: WALKIN token in Slot-B
├─ Priority 25 < EMERGENCY priority 100

Step 3: Execute eviction
├─ Remove WALKIN from Slot-B
├─ Add WALKIN to Slot-B queue
├─ Add EMERGENCY to Slot-B

Step 4: Result: EMERGENCY_ALLOCATED
├─ Slot-B: 30/30 (no change in occupancy)
├─ Composition: WALKIN replaced with EMERGENCY
├─ Queue: [WALKIN-Evicted]
└─ Emergency: GUARANTEED ALLOCATION

Note: WALKIN not lost, just queued for promotion
```

### Scenario 5: Cascading After Cancellation

```
Context:
├─ Slot-A: 30/30 (FOLLOW_UP-A in slot, high-priority)
├─ Slot-B: 30/30 (WALKIN-B in slot, low-priority)
├─ Queue: [FOLLOW_UP-Q1 (wants Slot-A)]

Event: FOLLOW_UP-A cancels from Slot-A

Process:
Step 1: Process cancellation
├─ Remove FOLLOW_UP-A from Slot-A
├─ Slot-A capacity: 30 → 29

Step 2: Check queue for Slot-A
├─ Is FOLLOW_UP-Q1 queued for Slot-A? YES
├─ Promote FOLLOW_UP-Q1 to Slot-A
├─ Slot-A capacity: 29 → 30

Step 3: Check for rebalancing
├─ Did promotion create opportunities?
├─ Slot-B still full, no change needed
├─ No cascading required

Result:
├─ FOLLOW_UP-Q1: PROMOTED from queue
├─ Slot-A: 30/30 (different FOLLOW_UP now)
├─ Queue: [] (empty)
├─ All fair, deterministic promotion
```

### Scenario 6: No-Show Rebalancing

```
Context:
├─ Slot-A: 30/30 with mixture
├─ Queue: [ONLINE-Q1, WALKIN-Q1]

Event: Token marked as NO-SHOW

Process:
Step 1: Treat as cancellation
├─ Remove no-show token from Slot-A
├─ Slot-A capacity: 30 → 29

Step 2: Promote from queue
├─ Check queue priority
├─ ONLINE-Q1 (priority 40) > WALKIN-Q1 (priority 25)
├─ Promote ONLINE-Q1 to Slot-A
├─ Slot-A capacity: 29 → 30

Step 3: Update queue
├─ Queue: [WALKIN-Q1]
├─ Next no-show triggers WALKIN promotion

Result:
├─ Slot-A: 30/30 (no-show replaced by promoted)
├─ Queue: [WALKIN-Q1]
├─ Fair, priority-based promotion
└─ System self-corrects
```

---

## Summary Table

| Feature | Rule | Example |
|---------|------|---------|
| **Priority Order** | EMERGENCY (100) > FOLLOW_UP (50) > PAID/ONLINE (40) > WALKIN (25) | FOLLOW_UP displaces WALKIN but not PAID |
| **Slot Capacity** | Hard limit, no exceptions except emergency | Slot-1: max 30, no over-allocation |
| **Token Cost** | 1 token = 1 capacity unit | 25 tokens + 1 new = 26/30 occupancy |
| **Allocation** | Direct to available slot | ONLINE token → Slot-1 if 25/30 |
| **No Capacity** | Queue or cascade | Slot full → Try other slots or queue |
| **Cancellation** | Promote queue or rebalance | Cancellation → promote FOLLOW_UP from queue |
| **No-Show** | Treat as cancellation | No-show → capacity freed → promote queued |
| **Emergency** | Override, never rejected | Emergency → evict WALKIN, allocate always |
| **Cascade** | Move lower-priority to queue | FOLLOW_UP needs space → move WALKIN to queue |

---

**Document Version**: 1.0  
**Last Updated**: January 28, 2026  
**Audience**: Product Managers, Business Analysts, Testers, Evaluators
