document.getElementById("loginForm").addEventListener("submit", function(e) {
  e.preventDefault();
  const id = document.getElementById("schoolId").value;
  const pass = document.getElementById("password").value;

  // Placeholder validation
  if(id && pass) {
    window.location.href = "/superadmin/dashboard"; 
  } else {
    alert("Please enter your credentials.");
  }
});
