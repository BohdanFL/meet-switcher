import type { ScreenShare, GroupStudent, ClassroomRosterState, RosterParticipant } from '../../types/index.ts';
import { ScreenDetector } from '../detector.ts';
import { extractFirstName } from '../../types/index.ts';

export class RosterDetector {
  private detector: ScreenDetector;

  constructor(detector: ScreenDetector) {
    this.detector = detector;
  }

  public reconcileRoster(
    shares: ScreenShare[],
    attendees: string[],
    groupStudents?: GroupStudent[]
  ): ClassroomRosterState {
    const activeSharers: RosterParticipant[] = [];
    const inCallNoScreen: RosterParticipant[] = [];
    const guests: RosterParticipant[] = [];
    const absentStudents: RosterParticipant[] = [];

    // Helper to normalize names
    const normalize = (name: string) => this.detector.normalizeParticipantName(name);

    if (groupStudents && groupStudents.length > 0) {
      for (const student of groupStudents) {
        const studentNorm = normalize(student.meetOriginalName || student.fullName);
        const shortName = student.shortAlias || extractFirstName(student.fullName);

        // Is student in call?
        const isPresent = attendees.some(a => {
          const aNorm = normalize(a);
          return aNorm.includes(studentNorm) || studentNorm.includes(aNorm);
        });
        
        // Is student sharing screen?
        const share = shares.find(s => {
          const shareNorm = normalize(s.participantName);
          return shareNorm.includes(studentNorm) || studentNorm.includes(shareNorm);
        });

        const participant: RosterParticipant = {
          id: student.id,
          name: shortName,
          category: share ? 'ACTIVE_SCREEN' : (isPresent ? 'IN_CALL_NO_SCREEN' : 'ABSENT'),
          screenShare: share,
          tileElement: share ? share.tileElement : null
        };

        if (share) {
          activeSharers.push(participant);
        } else if (isPresent) {
          inCallNoScreen.push(participant);
        } else {
          absentStudents.push(participant);
        }
      }

      // Identify guests (attendees not in LMS)
      for (const attendee of attendees) {
        const attNorm = normalize(attendee);
        const isInLms = groupStudents.some(s => {
          const sNorm = normalize(s.meetOriginalName || s.fullName);
          return attNorm.includes(sNorm) || sNorm.includes(attNorm);
        });
        
        if (!isInLms) {
          const share = shares.find(s => {
             const sNorm = normalize(s.participantName);
             return sNorm.includes(attNorm) || attNorm.includes(sNorm);
          });
          const participant: RosterParticipant = {
            id: `guest-${attNorm}`,
            name: attendee,
            category: share ? 'ACTIVE_SCREEN' : 'GUEST',
            screenShare: share,
            tileElement: share ? share.tileElement : null,
            isGuest: true
          };
          if (share) {
            activeSharers.push(participant);
          } else {
            guests.push(participant);
          }
        }
      }
    } else {
      // No LMS group loaded: Everyone is either ACTIVE_SCREEN or IN_CALL_NO_SCREEN
      for (const attendee of attendees) {
        const attNorm = normalize(attendee);
        const share = shares.find(s => {
           const sNorm = normalize(s.participantName);
           return sNorm.includes(attNorm) || attNorm.includes(sNorm);
        });
        
        const participant: RosterParticipant = {
          id: `att-${attNorm}`,
          name: attendee,
          category: share ? 'ACTIVE_SCREEN' : 'IN_CALL_NO_SCREEN',
          screenShare: share,
          tileElement: share ? share.tileElement : null
        };
        
        if (share) {
          activeSharers.push(participant);
        } else {
          inCallNoScreen.push(participant);
        }
      }
    }
    
    // Ensure all screen shares without attendees are also in activeSharers
    for (const share of shares) {
       const shareNorm = normalize(share.participantName);
       const isTracked = activeSharers.some(p => {
          const pNorm = normalize(p.name);
          return shareNorm.includes(pNorm) || pNorm.includes(shareNorm);
       });
       if (!isTracked) {
          activeSharers.push({
             id: `share-${share.id}`,
             name: share.participantName,
             category: 'ACTIVE_SCREEN',
             screenShare: share,
             tileElement: share.tileElement
          });
       }
    }

    // Sort active sharers by stable slot
    activeSharers.sort((a, b) => (a.screenShare?.index || 99) - (b.screenShare?.index || 99));

    return {
      activeSharers,
      inCallNoScreen,
      guests,
      absentStudents
    };
  }
}
