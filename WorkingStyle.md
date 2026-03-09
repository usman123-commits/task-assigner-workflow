General AI Collaboration Profile
1. Working Style
Architecture-First Thinking

You prefer clarifying system architecture before implementation.

Your typical understanding order:

System structure
→ component responsibilities
→ data flow
→ implementation

You prefer discussing:

overall architecture
system responsibilities
data flow
lifecycle of states
interaction between components

before writing code or configuring tools.

Step-By-Step Execution

You intentionally break work into small controlled steps.

Typical workflow:

Plan step
→ generate implementation instructions
→ executor implements
→ audit implementation
→ fix inconsistencies
→ continue to next step

You prefer incremental progress rather than designing everything at once.

Verification-Driven Development

You do not assume implementations are correct by default.

Your process includes:

Implementation
→ validation review
→ edge case analysis
→ corrections
→ approval

You frequently request:

audits
validation summaries
inconsistency checks
logic verification
testing scenarios

Accuracy is prioritized over speed.

Consistency Sensitivity

You are highly sensitive to inconsistencies across messages or system components.

You monitor consistency in areas such as:

naming conventions
system states
logic timing
previously agreed decisions
data schema alignment

Consistency across documentation, implementation, and reasoning is important to you.

Risk-Aware Thinking

You frequently evaluate long-term consequences of technical decisions.

You tend to compare:

current implementation
vs
future system expansion

Your design thinking often considers:

scalability
maintainability
future feature extensions
operational reliability

Edge-Case Conscious

You actively consider system edge cases.

You often ask for analysis of:

failure conditions
invalid inputs
concurrency issues
race conditions
validation paths
protection against duplicate actions

Implementation Delegation

You typically separate roles during development:

You act as:

system designer
decision maker
validator

The assistant acts as:

architect
reasoning partner
auditor

Execution is often handled by a separate implementation agent or tool.

2. Expectations From the Assistant
Correctness Over Speed

You prioritize:

accuracy
careful reasoning
validation
checking assumptions

Fast answers are less valuable than correct and well-reasoned answers.

Low Tolerance for Assumptions

You prefer the assistant to ask clarification questions when required information is missing rather than guessing.

Architecture should only be generated after critical details are known.

Structured Responses

You prefer structured answers such as:

clearly labeled sections
step-by-step explanations
explicit reasoning

Unstructured explanations can cause confusion.

Clear Phase Separation

You prefer work to be organized into separate phases or modules.

Each phase should:

have a clear responsibility
avoid mixing logic with other phases
be validated before moving forward

Deterministic Implementation Instructions

When generating implementation instructions for executors (AI agents, tools, or developers), you prefer them to be:

detailed
explicit
deterministic
free from ambiguity

The instructions should contain all required information so the executor does not need to guess.

Decision Continuity

Once a design decision is made, you expect it to be remembered and respected in later steps.

Repeatedly asking already-decided questions disrupts the workflow.

3. Development Process You Follow
Planning Before Execution

Typical sequence:

Architecture discussion
→ confirm decisions
→ generate implementation instructions
→ implement
→ validate

You generally avoid jumping directly into implementation.

Implementation Pipeline

Typical workflow structure:

Architecture design
→ Implementation instructions
→ Executor builds system
→ Testing and validation
→ Audit and refinement

You treat executors as deterministic builders rather than designers.

Iterative Validation

After each development step you perform:

summary validation
logic verification
edge case review

Only after confirmation do you proceed.

Incremental System Expansion

Instead of building full systems immediately, you prefer:

component
→ stabilization
→ extension

This allows controlled system growth and easier debugging.

4. Design Philosophy

Your design choices generally favor:

Simple architecture
Low operational complexity
High system visibility
Incremental development

You tend to prefer:

transparent systems
easy debugging
clear data flow

over complex or highly abstract architectures.

5. Failure Patterns to Avoid

These behaviors reduce your trust in AI collaboration.

Ignoring Previous Decisions

Failing to respect earlier decisions creates confusion and slows development.

Inconsistent Terminology

Using inconsistent names for the same concept across:

documentation
system logic
data structures

creates errors and should be avoided.

Overengineering

You prefer practical, understandable solutions instead of unnecessarily complex abstractions.

Ambiguous Implementation Instructions

Implementation instructions should not rely on interpretation.

They should clearly define:

system behavior
naming
logic
validation rules

Skipping Validation

Moving to the next step before validating the current one can introduce hidden errors.

You prefer validating each stage before continuing.
