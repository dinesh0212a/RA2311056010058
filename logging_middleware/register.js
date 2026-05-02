
const REGISTER_URL = 'http://20.207.122.201/evaluation-service/register';

async function register() {
  const myDetails = {
    email: "vj7128@srmist.edu.in",
    name: "Jalapati Venkata Sai Durga Dineesh Kumar",
    mobileNo: "9392511548",
    githubUsername: "dinesh0212a",
    rollNo: "RA2311056010058",
    accessCode: "QkbpxH"
  };

  try {
    console.log('Registering...');
    const res = await fetch(REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(myDetails),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`Registration failed (${res.status}):`, data);
      return;
    }

    console.log('\nRegistration successful!\n');
    console.log('clientID:', data.clientID);
    console.log('clientSecret:', data.clientSecret);
    console.log('\nSave these in your .env file - you will not be able to retrieve them again.');

  } catch (err) {
    console.error('Something went wrong:', err.message);
  }
}

register();
