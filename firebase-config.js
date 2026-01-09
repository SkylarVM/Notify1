rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isMember(convId) {
      return signedIn() &&
        exists(/databases/$(database)/documents/conversations/$(convId)) &&
        get(/databases/$(database)/documents/conversations/$(convId)).data.membersMap[request.auth.uid] == true;
    }

    match /users/{uid} {
      allow read: if signedIn();
      allow write: if signedIn() && request.auth.uid == uid;
    }

    match /handles/{handle} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if false;
    }

    match /conversations/{convId} {
      allow read: if isMember(convId);
      allow create: if signedIn();
      allow update: if isMember(convId);

      match /messages/{msgId} {
        allow read, create: if isMember(convId);
        allow update, delete: if false;
      }

      match /codes/{codeId} {
        allow read, write: if isMember(convId);
      }
    }

    match /invites/{token} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update: if signedIn();
      allow delete: if signedIn();
    }

    match /calls/{convId} {
      allow read, write: if isMember(convId);

      match /participants/{uid} {
        allow read, write: if isMember(convId);
      }

      match /signals/{signalId} {
        allow read, write: if isMember(convId);
      }
    }
  }
}
