## Purpose

Provides a multi-screen live overview grid (Classroom Wall) displaying up to 10 active student screens simultaneously with 1-click drill-down focus.

## ADDED Requirements

### Requirement: Multi-screen live grid rendering
The extension SHALL display an overlay grid showing live video streams of up to 10 active screen shares in Google Meet.

#### Scenario: Opening classroom wall with active streams
- **WHEN** the user opens the Classroom Wall while student screen shares are active
- **THEN** the extension renders a balanced CSS grid displaying live video streams for each student with their name and index number

#### Scenario: No active screens shared
- **WHEN** the user opens the Classroom Wall when no student has shared a screen
- **THEN** the extension displays a message indicating that no screens are currently shared

### Requirement: Zero-copy video mirroring
The extension SHALL mirror video streams directly from existing Meet `<video>` elements without creating extra network requests or re-encoding video.

#### Scenario: Stream mirroring via MediaStream
- **WHEN** a student screen share is rendered in the Classroom Wall
- **THEN** the preview video element binds to the existing video's MediaStream reference

#### Scenario: Resource release upon closing
- **WHEN** the Classroom Wall is closed or hidden
- **THEN** the mirrored video elements are detached and paused to consume zero extra CPU/GPU resources

### Requirement: 1-Click drill-down focus
The extension SHALL allow the teacher to click on any student's screen in the Classroom Wall to close the wall and immediately pin that student's presentation in Google Meet.

#### Scenario: Clicking a student thumbnail
- **WHEN** the user clicks on student 3's thumbnail in the Classroom Wall
- **THEN** the Classroom Wall closes and the extension automatically pins student 3 to the center stage in Google Meet

### Requirement: Toggle shortcuts and HUD controls
The extension SHALL support toggling the Classroom Wall via keyboard shortcut `Alt + W` and via a dedicated button in the MeetSwitcher HUD.

#### Scenario: Toggling wall with Alt + W
- **WHEN** the user presses `Alt + W`
- **THEN** the Classroom Wall toggles between open and closed

#### Scenario: Closing with Escape
- **WHEN** the Classroom Wall is open and the user presses `Escape` or clicks the close button
- **THEN** the Classroom Wall closes and returns to the previous Meet view
