for i in {0..9}
do
    echo "Starting attempt: #$i"
    NODE_ENV=test npm run test:e2e
    sleep 3
    echo "Finished attempt #$i"
done
