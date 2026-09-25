FROM alpine:3.22
RUN apk add --no-cache python3 restic rclone ca-certificates \
    && adduser -D -u 10001 backup
WORKDIR /job
COPY run.py /job/run.py
USER backup
ENTRYPOINT ["python3", "/job/run.py"]
