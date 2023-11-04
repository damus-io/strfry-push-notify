# Use an official Ubuntu runtime as a parent image
FROM ubuntu:latest

# Set the working directory in the container to /app
WORKDIR /app

# Install any needed packages specified in requirements.txt
RUN apt update && apt install -y --no-install-recommends \
    git \
    g++ \
    make \
    pkg-config \
    libtool \
    ca-certificates \
    build-essential \
    libyaml-perl \
    libtemplate-perl \
    libregexp-grammars-perl \
    libssl-dev \
    zlib1g-dev \
    liblmdb-dev \
    libflatbuffers-dev \
    libsecp256k1-dev \
    libb2-dev \
    libzstd-dev

# Clone the strfry repository
RUN git clone https://github.com/hoytech/strfry/ . && \
    git checkout 0.9.6 && \
    git submodule update --init

# Compile the project
RUN make setup-golpe && \
    make -j4

# Expose port for the application
EXPOSE 8080

# Run the relay when the container launches
CMD ["./strfry", "relay"]