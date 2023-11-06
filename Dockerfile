ARG DENO_VERSION=1.38.0

# Use an official Deno runtime to copy the Deno binary into the final image
FROM denoland/deno:bin-$DENO_VERSION AS deno
# Use an official Ubuntu runtime as a parent image
FROM --platform=linux/amd64 ubuntu:latest

# Copy the deno binary into the final image
COPY --from=deno /deno /usr/local/bin/deno

RUN apt update && apt install -y --no-install-recommends libc6

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
    make -j2

# Copy strfry.conf into the container at current working directory
ADD test_strfry.conf strfry.conf
ADD src NotificationApp

# Expose port for the application
EXPOSE 7777

# Run the relay when the container launches
CMD ["./strfry", "relay"]
