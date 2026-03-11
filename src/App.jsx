import './App.css';
import './index.css';
import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import Progress from './Progress';  // Import the Progress component

const AnimatedBackground = lazy(() => import('./AnimatedBackground'));


function App() {
  const [ready, setReady] = useState(null);
  const [disabled, setDisabled] = useState(false);
  const [progressItems, setProgressItems] = useState([]);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  const [questions, setQuestions] = useState([]);
  const [contextIndex, setContextIndex] = useState(null);
  const [output, setOutput] = useState('');
  const [outputMeta, setOutputMeta] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [thinkingStatus, setThinkingStatus] = useState('');
  const [showBackground, setShowBackground] = useState(false);

  const worker = useRef(null);
  const thinkingClearTimer = useRef(null);

  useEffect(() => {
    // Load questions from questions.txt file
    fetch('/questions.txt')
      .then(response => response.text())
      .then(data => {
        const questionsArray = data.split('\n').map(q => q.trim()).filter(Boolean);  // Split and clean the questions
        setQuestions(questionsArray);
        const randomQuestion = questionsArray[Math.floor(Math.random() * questionsArray.length)];  // Select a random question
        setQuestion(randomQuestion);  // Set the random question
      })
      .catch(error => {
        console.error('Error loading questions:', error);
        setError('Error loading questions file');
      });
  }, []);

  useEffect(() => {
    // Load context manifest
    fetch('/context/index.json')
      .then(response => response.json())
      .then(data => setContextIndex(data))
      .catch(error => {
        console.error('Error loading context:', error);
        setError('Error loading context manifest');
      });

    if (!worker.current) {
      worker.current = new Worker(new URL('./worker.js', import.meta.url), {
        type: 'module'
      });
    }

    const onMessageReceived = (e) => {
      if (thinkingClearTimer.current) {
        clearTimeout(thinkingClearTimer.current);
        thinkingClearTimer.current = null;
      }

      switch (e.data.status) {
        case 'initiate':
          setReady(false);
          setOutput('');
          setOutputMeta(null);
          setProgressItems(prev => [...prev, e.data]);
          setThinkingStatus('Downloading model files...');
          break;
        case 'progress':
          setProgressItems(prev => prev.map(item => (item.file === e.data.file ? { ...item, progress: e.data.progress } : item)));
          setThinkingStatus('Downloading model files...');
          break;
        case 'done':
          setProgressItems(prev => prev.filter(item => item.file !== e.data.file));
          break;
        case 'ready':
          setReady(true);
          setThinkingStatus('Model ready.');
          break;
        case 'thinking':
          setThinkingStatus(e.data.message || 'Electra is thinking...');
          break;
        case 'update':
          break;
        case 'complete':
          setOutput(e.data.output);
          setOutputMeta(e.data.metadata || null);
          setConversation(prev => [...prev, { role: 'assistant', content: e.data.output }]);
          setDisabled(false);
          setThinkingStatus('Answer ready.');
          thinkingClearTimer.current = setTimeout(() => {
            setThinkingStatus('');
          }, 1500);
          break;
        case 'error':
          setError(e.data.error);
          setDisabled(false);
          setThinkingStatus('');
          break;
        default:
          break;
      }
    };

    worker.current.addEventListener('message', onMessageReceived);

    return () => {
      worker.current.removeEventListener('message', onMessageReceived);
      if (thinkingClearTimer.current) {
        clearTimeout(thinkingClearTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    let backgroundTimer;
    let backgroundIdleId;

    const updateBackground = () => {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
      }

      if (backgroundIdleId && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(backgroundIdleId);
        backgroundIdleId = null;
      }

      const saveData = Boolean(connection?.saveData);
      const shouldEnable = !media.matches && !saveData;

      if (!shouldEnable) {
        setShowBackground(false);
        return;
      }

      const enableBackground = () => setShowBackground(true);

      if ('requestIdleCallback' in window) {
        backgroundIdleId = window.requestIdleCallback(enableBackground, { timeout: 1800 });
      } else {
        backgroundTimer = setTimeout(enableBackground, 900);
      }
    };

    updateBackground();
    media.addEventListener('change', updateBackground);
    connection?.addEventListener?.('change', updateBackground);

    return () => {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
      }
      if (backgroundIdleId && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(backgroundIdleId);
      }
      media.removeEventListener('change', updateBackground);
      connection?.removeEventListener?.('change', updateBackground);
    };
  }, []);

  const answer = () => {
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError('Please enter a question.');
      return;
    }

    setDisabled(true);
    setError('');
    setOutput('');
    setOutputMeta(null);
    setThinkingStatus('Reading your question...');

    const nextConversation = [...conversation, { role: 'user', content: trimmedQuestion }];
    setConversation(nextConversation);

    worker.current.postMessage({
      question: trimmedQuestion,
      contextIndex,
      history: nextConversation.slice(-8),
    });
  };

  return (
    <>
      <Suspense fallback={null}>
        {showBackground ? <AnimatedBackground /> : null}
      </Suspense>

      <div className="container">
          <div className="profile-header">
              <div className="profile-info">
                  <h1>Aditya Chaugule</h1>
                  <p><i className="fas fa-globe-americas"></i> United States</p>
                  <p><i className="fas fa-briefcase"></i> Roboticist × Engineer</p>
                  <hr className="separator" />
                  <p className="profile-description">
                      I am a Robotics Engineer with a passion for developing intelligent machines that can perceive, reason and act in the real world.
                  </p>
              </div>
              <img className="profile-pic" alt="Aditya Chaugule" src="/images/pic.jpg" />
          </div>
          <div className="buttons">
              <a href="https://drive.google.com/file/d/1E_SWqaDaIXIoUb0OtXxWPoBxE9UlyPwc/view?usp=drive_link" target="_blank"><i class="fas fa-briefcase"></i> Portfolio</a>
              <a href="https://www.linkedin.com/in/adityachaugule" target="_blank"><i className="fab fa-linkedin"></i> adityachaugule</a>
              <a href="https://github.com/Tys0nus" target="_blank"><i className="fab fa-github"></i> Tys0nus</a>
              <a href="mailto:aditya97@terpmail.umd.edu"><i className="fas fa-envelope"></i> Email</a>
          </div>
      </div>

      <div className="output">
      <div className="thinking-status">{thinkingStatus}</div>
      {output && outputMeta ? (
        <div className="output-badge">{`${outputMeta.confidence}% | ${outputMeta.sourceLabel}`}</div>
      ) : null}
      <div className={`output-box ${output ? 'has-output' : 'is-empty'}`}>
        <div className="output-content">
          {output ? output : (disabled ? 'Electra is thinking...' : 'Electra on standby... Ask about Aditya\'s work, skills, or projects.')}
        </div>
      </div>
      </div>

      <div className="chat-container">
              <div className="input-container">
                <textarea className="input" value={question} rows={1} onChange={e => setQuestion(e.target.value)} placeholder="Ask Electra about me!"></textarea>
                <button className="ask-button" disabled={disabled} onClick={answer}><i class="fa fa-paper-plane" aria-hidden="true"></i></button>
          </div>
      </div>

      <div className='progress-bars-container'>
          {ready === false && (
            <label>Loading Electra ... (first run downloads model)</label>
          )}
          {progressItems.map(data => (
            <div key={data.file}>
              <Progress text={data.file} percentage={data.progress} />
            </div>
          ))}
      </div>

      <div className='disclaimer'>
        Explore Aditya's projects and engineering through Electra - runs locally in your browser
      </div>
    </>

  );
}

export default App;
