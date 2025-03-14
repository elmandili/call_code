import './style.css';
import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA12sTmrpBk5E_qOGZoE87o5tsHAltq_ok",
  authDomain: "call-code.firebaseapp.com",
  projectId: "call-code",
  storageBucket: "call-code.firebasestorage.app",
  messagingSenderId: "1018236783367",
  appId: "1:1018236783367:web:a7c944d60c9d6fc0ecd3a2",
  measurementId: "G-02J535HGRJ"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let callDoc = null; // Store the Firestore document reference

// HTML elements
const webcamButton = document.getElementById('webcamButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  webcamVideo.muted = true;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 4. Hangup the call
hangupButton.onclick = () => {
  // Close the peer connection
  pc.close();

  // Stop all tracks in the local stream
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }

  // Stop all tracks in the remote stream
  if (remoteStream) {
    remoteStream.getTracks().forEach((track) => track.stop());
  }

  // Reset video elements
  webcamVideo.srcObject = null;
  remoteVideo.srcObject = null;

  // Reset UI
  webcamButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;
  callInput.value = '';

  // Clear Firestore data (optional)
  if (callDoc) {
    callDoc.delete();
  }

  console.log('Call ended.');
};



// HTML elements
const shareScreenButton = document.getElementById('shareScreenButton');

// Screen sharing stream
let screenStream = null;

// Share screen
shareScreenButton.onclick = async () => {
  try {
    // Capture the screen
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true, // Set to false if you don't want to share audio
    });

    // Replace the local video stream with the screen stream
    webcamVideo.srcObject = screenStream;

    // Replace the tracks in the peer connection
    const senders = pc.getSenders();
    senders.forEach((sender) => {
      if (sender.track.kind === 'video') {
        sender.replaceTrack(screenStream.getVideoTracks()[0]);
      }
    });

    // Disable the "Share Screen" button after starting
    shareScreenButton.disabled = true;

    // Stop screen sharing when the user clicks "Stop Sharing" in the browser UI
    screenStream.getVideoTracks()[0].onended = () => {
      stopScreenSharing();
    };
  } catch (error) {
    console.error('Error sharing screen:', error);
  }
};

// Stop screen sharing
function stopScreenSharing() {
  if (screenStream) {
    screenStream.getTracks().forEach((track) => track.stop());
    screenStream = null;
  }

  // Re-enable the "Share Screen" button
  shareScreenButton.disabled = false;

  // Restore the local webcam stream
  if (localStream) {
    webcamVideo.srcObject = localStream;

    // Replace the tracks in the peer connection with the webcam stream
    const senders = pc.getSenders();
    senders.forEach((sender) => {
      if (sender.track.kind === 'video') {
        sender.replaceTrack(localStream.getVideoTracks()[0]);
      }
    });
  } else {
    webcamVideo.srcObject = null;
  }
}