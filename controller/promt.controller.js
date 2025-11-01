import { Promt } from "../model/promt.model.js";

// Configuration for the Gemini API
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent";
const MAX_RETRIES = 5;
const apiKey = process.env.GEMINI_API_KEY || ""; // Use the environment variable for the Gemini key

/**
 * Calls the Gemini API with exponential backoff for transient errors (429, 5xx).
 * @param {object} payload - The body of the request to send to the generateContent endpoint.
 * @returns {Promise<string>} The generated text content from the AI.
 */
const callGeminiAPI = async (payload) => {
    // The API key is appended as a query parameter
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // Handle retryable errors (Rate Limit or Server Errors)
            if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
                if (i < MAX_RETRIES - 1) {
                    // Exponential backoff with jitter
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 500; 
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Retry the request
                } else {
                    const errorText = await response.text();
                    throw new Error(`Gemini API call failed after ${MAX_RETRIES} attempts. Status: ${response.status}. Body: ${errorText}`);
                }
            }

            // Handle non-retryable errors (e.g., 400 Bad Request)
            if (!response.ok) {
                const errorBody = await response.json();
                throw new Error(`Gemini API Client Error: ${response.status} - ${JSON.stringify(errorBody)}`);
            }

            const result = await response.json();

            // Parse the generated text content from the Gemini response structure
            const aiContent = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!aiContent) {
                // This handles successful API calls where the model response is empty or blocked
                throw new Error('Gemini API response successful but generated content text is missing or was blocked.');
            }

            return aiContent;

        } catch (error) {
            if (i === MAX_RETRIES - 1) {
                // Re-throw the error if it was a non-retryable fetch error or the last attempt
                throw error;
            }
            // For transient network errors, the loop continues if not the last attempt
        }
    }
    // Fallback error, should not be reached if MAX_RETRIES is set correctly
    throw new Error("Failed to get response from Gemini API.");
};


export const sendPromt = async (req, res) => {
    const { content } = req.body;
    const userId = req.userId;

    if (!content || content.trim() === "") {
        return res.status(400).json({ errors: "Promt content is required" });
    }

    try {
        // 1. Save user prompt to database
        const userPromt = await Promt.create({
            userId,
            role: "user",
            content,
        });

        // 2. Construct Gemini API payload (for a single user turn)
        const payload = {
            contents: [{ parts: [{ text: content }] }],
        };

        // 3. Send to Gemini API using the fetch helper function
        const aiContent = await callGeminiAPI(payload);

        // 4. Save assistant response to database
        const aiMessage = await Promt.create({
            userId,
            role: "assistant",
            content: aiContent,
        });

        // 5. Return success response
        return res.status(200).json({ reply: aiContent });

    } catch (error) {
        console.error("Error in Promt/Gemini API: ", error);
        
        // Provide a clearer error message if it came from the API call
        const errorMessage = error.message.includes("Gemini API") 
            ? error.message 
            : "Something went wrong with the AI response.";

        return res
            .status(500)
            .json({ error: errorMessage });
    }
};
