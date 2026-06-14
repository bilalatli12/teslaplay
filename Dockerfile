# Use the official lightweight Node.js parent image
FROM node:18-slim

# Install Python3, FFmpeg, and curl
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set python3 as the default python command
RUN ln -s /usr/bin/python3 /usr/bin/python

# Create app directory in the container
WORKDIR /usr/src/app

# Copy dependency definition files
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose the application port
EXPOSE 3000

# Start the server
CMD [ "node", "server.js" ]
