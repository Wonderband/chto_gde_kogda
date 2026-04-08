Yes, I can verify that the **OpenAI Realtime API specifically allows for "under the hood" communication** while a dialogue is ongoing 1, 2\. Because the API operates over a **long-lived WebSocket or WebRTC connection**, the model and your app can exchange **JSON events** (signals) asynchronously without interrupting the audio stream 3, 4\.  
As an expert, I have designed a block schema below that illustrates the event flow for your "What? Where? When?" game, showing how the app and model communicate to switch modes.

### Event Flow Schema: Dialogue to Monologue Transition

Phase,App (React Client),Direction,OpenAI Model (Server),Event/Action Type  
1\. Init,"Establishes connection 1, 5",→,"Sends session.created 6, 7",Connection Setup  
,"Sends session.update (Tools, Voice, VAD ON) 8, 9",→,"Sends session.updated 6, 9",Configuration  
2\. Dialogue,(Roulette Spin),,,  
,Streams Mic Audio 10,→,"Processes Audio 11, 12",User Input  
,,←,"response.audio.delta (Jokes/Chat) 13, 14",Model Response  
3\. Trigger,(Timer hits 60s),,,"""Under the Hood"""  
,"Sends conversation.item.create (hidden system text) 15, 16",→,"Receives signal: ""Stop and read question""",System Message  
,,←,"response.done with Tool Call 17, 18",Signal to App  
4\. Mode Switch,(App receives Tool Call),,,The Transition  
,App Hits Gong Sound,,,Local Logic  
,"Sends session.update (VAD OFF) 19, 20",→,"Becomes ""deaf"" to user 19, 20",Mode Switching  
,Mutes Mic on client side 15,,,Client Logic  
5\. Monologue,"Sends response.create (Text from JSON) 16, 19",→,Starts reading question 16,Generation  
,,←,response.audio.delta (Reading) 21,Output Only  
6\. Result,,←,response.done 17,Completion

### Technical Breakdown of the "Under the Hood" Communication

* **Asynchronous JSON Streaming:** The Realtime API sends text and audio chunks **faster than they can be spoken** 22, 23\. This allows your React app to "see" the text of what the model is about to say via response.audio\_transcript.delta before the user actually hears the audio, giving your app a "head start" to trigger visual changes or sounds like the gong 22, 24\.  
* **The DataChannel:** If using WebRTC, the **DataChannel** is the dedicated "under the hood" pipe for JSON events 3\. This is where your function\_call and session.update messages live, separate from the audio tracks 3\.  
* **Stateful Memory:** Unlike standard Chat APIs, the Realtime API is **stateful** 22, 25\. It remembers the "Small Talk" context automatically, so when you transition to the question, you don't have to re-send the whole history, saving you money and reducing latency 25, 26\.  
* **Manual Turn Control:** By sending a session.update to set turn\_detection to null (or none), your app effectively takes the steering wheel from the model 19, 20\. This is the precise moment your app "locks" the model into its Monologue mode for the question reading 19, 20\.

**Conclusion for your use case:** This architecture is perfect for your game because it allows the model to be a "social" moderator one moment and a "strict" question-reader the next, with the React app acting as the silent producer who signals when to switch 19\.  
