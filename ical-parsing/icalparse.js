// npm install node-ical he axios geolib dotenv fs natural
const ical = require('node-ical');
const he = require('he');
const axios = require('axios');
const geolib = require('geolib');
const fs = require('fs');
const natural = require('natural');
const tokenizer = new natural.WordTokenizer();
const stemmer = natural.PorterStemmer;
require('dotenv').config()

// Make a .env file and add your Google Maps API key like this:
// GoogleMapsAPI=thisistheapikey
// DATABASE_HOST=localhost
const API_KEY = process.env.GoogleMapsAPI;

const referenceLocation = {
    latitude: 39.74318700108676, // Coordinates somewhere in the middle of Auraria Campus
    longitude: -105.00600561574313
};

function calculateDistance(coord1, coord2) {
    const distance = geolib.getDistance(coord1, coord2);
    return geolib.convertDistance(distance, 'mi'); 
}

// These are the keywords that will automatically map to an address if found in parsed locations
const buildingCodeToAddress = {
    "PE": "1201 5th St, Denver, CO 80204",
    "Tivoli": "900 Auraria Pkwy, Denver, CO 80204",
    "Plaza": "955 Lawrence Way, Denver, CO 80204",
    "SSB": "890 Auraria Pkwy, Denver, CO 80204",
    "JSSB": "1380 Lawrence St, Denver, CO 80204",
    "CVA": "965 Santa Fe Dr, Denver, CO 80204",
    "KHE": "890 Auraria Pkwy, Denver, CO 80204",
    "STC": "1201 5th St, Denver, CO 80204",
    "SAC": "777 Lawrence Way, Denver, CO 80204",
    "Science": "1150 12th St, Denver, CO 80204",
    "Admin":"1201 5th St, Denver, CO 80204",
    "AD":"1201 5th St, Denver, CO 80204",
    "Library": "1100 Lawrence St, Denver, CO 80204",
    "King": "855 Lawrence Way, Denver, CO 80204",
    // Add other mappings here
};

// These tags will be assigned to events based on keywords in the title and description
const tags = {
    "academic": ["lecture", "seminar", "class", "course", "academic", "education", "study", "research"],
    "career": ["career", "job fair", "internship", "employment", "resume", "interview"],
    "training": ["training", "workshop", "session", "learn", "skill", "development"],
    "holiday": ["holiday", "independence day", "thanksgiving", "christmas", "new year", "halloween"],
    "administrative": ["office", "admin", "administrative"],
    "fitness": ["zumba", "fitness", "workout", "health", "exercise", "yoga", "gym", "hiking", "running", "cycling"],
    "professional development": ["professional development", "skills", "growth", "leadership"],
    "arts and culture": ["art", "culture", "exhibition", "walk", "gallery", "museum", "performance"],
    "technology": ["technology", "tech", "computer", "software", "coding", "programming", "webinar", "hackathon"],
    "community engagement": ["community", "engage", "outreach", "volunteer", "service", "activism"],
    "health and wellness": ["health", "wellness", "wellbeing", "nutrition", "mental health", "self-care"],
    "social": ["social", "party", "celebration", "happy hour", "mixer", "reception"],
    "sports": ["sports", "game", "tournament", "match", "competition", "athletics", "volleyball", "basketball", "soccer", "football"],
    "music": ["music", "concert", "performance", "band", "orchestra", "choir"],
    "film": ["film", "movie", "screening", "cinema", "documentary", "short film"],
    "esports": ["esports", "gaming"],
    "food and drink": ["food", "drink", "dining", "restaurant", "cooking", "culinary", "beer", "wine"],
    "club": ["club", "organization", "society"],
    "political": ["political", "politics", "government", "election", "voting", "democracy"],
};

async function fetchAndParseIcal(url, seenUIDs) {
    try {
        const events = await ical.async.fromURL(url);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to the start of today

        // This array will store all parsed events that make it past the filters
        const parsedEvents = [];


        for (const event of Object.values(events)) {
            // Events in ical are labeled as 'VEVENT'
            if (event.type === 'VEVENT' && !seenUIDs.has(event.uid)) {
                // Using the node-ical package, we can access properties of the event like this
                // UIDs are unique identifiers for events, so we can use this to filter out duplicates
                seenUIDs.add(event.uid);
                const eventTitle = event.summary || '';
                const eventStart = event.start || '';
                const eventEnd = event.end || '';
                const eventDescription = event.description || '';
                const eventUrl = event.url || '';
                const originalLocation = event.location || '';
                const cleanedLocation = cleanLocation(originalLocation);

                // Filter out events that are not happening today or later
                if (event.start >= today) {
                    // console.log(`Checking address: ${cleanedLocation}`); 
                    const { isValidAddress, formattedAddress, validityLabel } = await checkAddress(cleanedLocation);
                    const eventTags = assignTags(eventTitle, eventDescription);
                    parsedEvents.push({
                        uid: event.uid,
                        title: eventTitle,
                        start: eventStart,
                        end: eventEnd,
                        description: eventDescription,
                        url: eventUrl,
                        originalLocation: originalLocation,
                        cleanedLocation: cleanedLocation,
                        isValidLocation: validityLabel,
                        geocodedAddress: formattedAddress,
                        googleMapsUrl: generateGoogleMapsUrl(cleanedLocation),
                        tags: eventTags
                    });
                    if (isRemoteEvent(cleanedLocation)) {
                        parsedEvents[parsedEvents.length - 1].isValidLocation = 'valid and remote';
                    }
                }
            }
        }

        return parsedEvents;
    } catch (error) {
        console.error('Error fetching events:', error);
        throw error;
    }
}

function cleanLocation(location) {
    // Decode HTML entities
    location = he.decode(location);

    // Check if the location is a building code and room number
    const buildingCodeMatch = location.match(/^([A-Z]+)\s(\d+)$/);
    if (buildingCodeMatch) {
        const buildingCode = buildingCodeMatch[1];
        if (buildingCodeToAddress[buildingCode]) {
            return `${buildingCodeToAddress[buildingCode]}, Room ${buildingCodeMatch[2]}`;
        }
    }

    // Check if the location is a known building code without room number
    const knownBuildingCode = Object.keys(buildingCodeToAddress).find(code => location.includes(code));
    if (knownBuildingCode) {
        return buildingCodeToAddress[knownBuildingCode];
    }

    // Replace <br> with commas and remove any remaining HTML tags
    return location.replace(/<br>/g, ', ').replace(/<[^>]+>/g, '');
}

function isRemoteEvent(location) {
    // Look through keywords that indicate a remote event
    const lowerCaseLocation = location.toLowerCase();
    return lowerCaseLocation.includes('remote') || 
           lowerCaseLocation.includes('teams') || 
           lowerCaseLocation.includes('online') ||
           lowerCaseLocation.includes('zoom');
}

function generateGoogleMapsUrl(location) {
    // Encode the location to be used in the URL to see if it's the right address manually
    const encodedLocation = encodeURIComponent(location);
    return `https://www.google.com/maps/search/?api=1&query=${encodedLocation}`;
}

async function checkAddress(address) {
    // Use the Google Maps Geocoding API to check if the address is valid and returns a location
    // We will use the first result from the API response
    // The API response will contain a 'status' field that indicates if the request was successful
    // If the status is 'OK', the response will contain an array of 'results' with the geocoded locations
    // If we have multiple results, we will calculate the distance to the reference location and choose the closest one
    // If the closest result is within 5 miles, we will consider it a valid address
    // If the closest result is more than 5 miles away, we will consider it an invalid address
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${API_KEY}`;
    try {
        const response = await axios.get(url);
        console.log(`Geocode API response for "${address}":`, response.data); // Log the API response

        // Check if the API response is successful and has results
        if (response.data.status === 'OK') {
            const results = response.data.results;
            const validResults = results.map(result => ({
                address: result.formatted_address,
                location: {
                    latitude: result.geometry.location.lat,
                    longitude: result.geometry.location.lng
                }
            }));

            // Calculate the distances from the address to the reference location (Auraria Campus)
            const distances = validResults.map(result => ({
                ...result,
                distance: calculateDistance(referenceLocation, result.location)
            }));

            // Sort the locations by distance and find the closest one
            const closestResult = distances.reduce((prev, curr) => prev.distance < curr.distance ? prev : curr, distances[0]);

            if (closestResult.distance <= 5) {
                if (validResults.length === 1) {
                    // 'yes' means the address is valid and there are no other possible addresses
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'yes' };
                } else {
                    // 'maybe' means the address is valid but there are other possible addresses
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe' };
                }
            } else {
                // 'maybe not' means the addresses are 'OK' but are too far away
                return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe not' };
            }
        }
        // If we reach this point, the address must be invalid
        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    } catch (error) {
        console.error('Error checking address:', error);
        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    }
}

function assignTags(eventTitle, eventDescription) {
    // Tokenize the event title and description, stem the tokens, and assign tags based on keywords
    // Tokenizing is the process of splitting text into individual words or tokens
    // Stemming is the process of reducing words to their root form (e.g., 'running' -> 'run')
    const text = `${eventTitle} ${eventDescription}`.toLowerCase();
    const tokens = tokenizer.tokenize(text);
    const stemmedTokens = tokens.map(token => stemmer.stem(token));
    const assignedTags = [];

    // Check if any of the stemmed tokens match the keywords for each tag
    for (const [tag, keywords] of Object.entries(tags)) {
        for (const keyword of keywords) {
            const stemmedKeyword = stemmer.stem(keyword.toLowerCase());
            if (stemmedTokens.includes(stemmedKeyword)) {
                assignedTags.push(tag);
                break;
            }
        }
    }
    // If no tags are assigned, default to 'Uncategorized'
    return assignedTags.length ? assignedTags : ['Uncategorized'];
}

async function main() {
    const urls = [
        'https://www.trumba.com/calendars/msudenver-events-calendars.ics',
    ];
    const seenUIDs = new Set();
    const allEvents = [];

    for (const url of urls) {
        const events = await fetchAndParseIcal(url, seenUIDs);
        allEvents.push(...events); // The ... in this line is the spread operator, which unpacks the array
    }

    // Write events to results.txt
    fs.writeFileSync('results.txt', ''); // Clear the contents of results.txt before writing
    allEvents.forEach(event => {
        const eventInfo = `UID: ${event.uid}\n` + 
                          `Title: ${event.title}\n` +
                          `Start: ${event.start}\n` +
                          `End: ${event.end}\n` +
                          `Description: ${event.description}\n` +
                          `URL: ${event.url}\n` +
                          `Original Location: ${event.originalLocation}\n` +
                          `Cleaned Location: ${event.cleanedLocation}\n` +
                          `Valid Location: ${event.isValidLocation}\n`;

        if (event.isValidLocation === 'remote') {
            fs.appendFileSync('results.txt', eventInfo + '---\n');
            return;
        }

        const locationInfo = `Geocoded Address: ${event.geocodedAddress}\n` +
                             `Google Maps URL: ${event.googleMapsUrl}\n` +
                             `Tags: ${event.tags.join(', ')}\n`;

        fs.appendFileSync('results.txt', eventInfo + locationInfo + '---\n');
    });
}

main().catch(console.error);
