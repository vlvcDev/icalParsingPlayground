const ical = require('node-ical');
const he = require('he');
const axios = require('axios');
const geolib = require('geolib');
const fs = require('fs');
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

async function fetchAndParseIcal(url) {
    try {
        const events = await ical.async.fromURL(url);
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to the start of today

        // This array will store all parsed events that make it past the filters
        const parsedEvents = [];

        for (const event of Object.values(events)) {
            // Events in ical are labeled as 'VEVENT'
            if (event.type === 'VEVENT') {
                // Using the node-ical package, we can access properties of the event like this
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
                    // console.log(`Address valid: ${isValidAddress}, Label: ${validityLabel}, Geocoded Address: ${formattedAddress}`);
                    parsedEvents.push({
                        title: eventTitle,
                        start: eventStart,
                        end: eventEnd,
                        description: eventDescription,
                        url: eventUrl,
                        originalLocation: originalLocation,
                        cleanedLocation: cleanedLocation,
                        isValidLocation: validityLabel,
                        geocodedAddress: formattedAddress,
                        googleMapsUrl: generateGoogleMapsUrl(cleanedLocation)
                    });
                    if (isRemoteEvent(cleanedLocation)) {
                        parsedEvents[parsedEvents.length - 1].isValidLocation = 'remote';
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

        if (response.data.status === 'OK') {
            const results = response.data.results;
            const validResults = results.map(result => ({
                address: result.formatted_address,
                location: {
                    latitude: result.geometry.location.lat,
                    longitude: result.geometry.location.lng
                }
            }));

            // Calculate distances and find the closest result
            const distances = validResults.map(result => ({
                ...result,
                distance: calculateDistance(referenceLocation, result.location)
            }));

            // 
            const closestResult = distances.reduce((prev, curr) => prev.distance < curr.distance ? prev : curr, distances[0]);

            if (closestResult.distance <= 5) {
                if (validResults.length === 1) {
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'yes' };
                } else {
                    return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe' };
                }
            } else {
                return { isValidAddress: true, formattedAddress: closestResult.address, validityLabel: 'maybe not' };
            }
        }

        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    } catch (error) {
        console.error('Error checking address:', error);
        return { isValidAddress: false, formattedAddress: '', validityLabel: 'no' };
    }
}

async function main() {
    const url = 'https://www.trumba.com/calendars/msudenver-events-calendars.ics';
    const events = await fetchAndParseIcal(url);

    // Print events, yeehaw
    events.forEach(event => {
        const eventInfo = `Title: ${event.title}\n` +
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
                             `Google Maps URL: ${event.googleMapsUrl}\n`;

        fs.appendFileSync('results.txt', eventInfo + locationInfo + '---\n');
    });
}

main().catch(console.error);
