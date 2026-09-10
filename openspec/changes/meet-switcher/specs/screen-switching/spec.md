## Purpose

Enables fast, low-friction switching between multiple active student screen shares in Google Meet through 1-click controls and keyboard shortcuts.

## ADDED Requirements

### Requirement: Screen share detection
The extension SHALL scan Google Meet video tiles and identify video streams that represent screen shares while ignoring regular webcams.

#### Scenario: Detecting screen share stream
- **WHEN** a participant begins sharing their screen in the meeting
- **THEN** the extension recognizes the tile as a screen share and extracts the participant's name

#### Scenario: Excluding regular webcams
- **WHEN** participants have only webcams active without presenting
- **THEN** the extension does not list them as screen shares

### Requirement: 1-click Pin and Unpin switching
The extension SHALL automatically unpin any active pinned stream and pin the selected student screen share stream when requested.

#### Scenario: Switching from one presentation to another
- **WHEN** the user selects student 2 while student 1 is currently pinned
- **THEN** the extension clicks the unpin button for student 1 and clicks the pin button for student 2

#### Scenario: Pinning with no active pinned stream
- **WHEN** no stream is currently pinned and the user selects student 1
- **THEN** the extension directly pins student 1 to the main stage

### Requirement: Floating HUD overlay
The extension SHALL render a floating HUD inside an isolated Shadow DOM displaying the list of active presentations, current pinned state, and shortcut hints.

#### Scenario: Displaying HUD with active streams
- **WHEN** active screen shares exist in the meeting
- **THEN** the HUD displays numbered buttons with participant names and marks the currently pinned participant

#### Scenario: Drag and collapse HUD
- **WHEN** the user drags the HUD or clicks minimize
- **THEN** the HUD updates its position or collapses and persists state across page reloads

### Requirement: Keyboard shortcuts
The extension SHALL listen for `Alt + 1` through `Alt + 9` to switch directly to students, and `Alt + ArrowLeft / ArrowRight` (and `Alt + J / K`) to cycle between students.

#### Scenario: Switching via direct shortcut
- **WHEN** the user presses `Alt + 1`
- **THEN** the extension pins student 1 to the center stage

#### Scenario: Preventing hotkeys while typing in chat
- **WHEN** the user is typing inside an input or textarea (such as the meeting chat box)
- **THEN** hotkey events are ignored and do not trigger stream switching
